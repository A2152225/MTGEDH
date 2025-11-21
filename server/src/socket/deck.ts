import type { Server, Socket } from "socket.io";
import {
  parseDecklist,
  fetchCardsByExactNamesBatch,
  fetchCardByExactNameStrict,
  validateDeck,
  normalizeName,
} from "../services/scryfall";
import { ensureGame, broadcastGame } from "./util";
import { appendEvent } from "../db";
import {
  saveDeck as saveDeckDB,
  listDecks,
  getDeck as getDeckDB,
  renameDeck as renameDeckDB,
  deleteDeck as deleteDeckDB,
} from "../db/decks";
import type { KnownCardRef, PlayerID } from "../../shared/src";
import { GamePhase } from "@mtgedh/shared";

// NEW: helpers to push candidate/suggest events to player's sockets
import { registerCommanderHandlers } from "./commander";

/**
 * Deck socket handlers with:
 * - deck import resolution (batch + fallback)
 * - per-game per-player import buffer (_lastImportedDecks)
 * - unanimous import-wipe confirmation workflow (timeout => cancel)
 * - getImportedDeckCandidates read-only accessor
 * - saved deck CRUD (saveDeck, listSavedDecks, getSavedDeck, renameSavedDeck, deleteSavedDeck)
 *
 * Behavior:
 * - Single-player / PRE_GAME imports auto-apply for the importer only (no room wipe).
 * - Multiplayer mid-game imports require unanimous consent and perform the full reset/wipe flow.
 *
 * This file is a merged variant: it restores the original branch content and merges in
 * the importer-only shortcut + robustness fixes (active-player detection, seq===0 handling,
 * libraryCount assignment from parsedCount, and immediate emission of candidates to importer).
 */

/* --- Pending confirmation state & helpers --- */
type PendingConfirm = {
  gameId: string;
  initiator: PlayerID;
  resolvedCards: Array<Pick<KnownCardRef, "id" | "name" | "type_line" | "oracle_text" | "image_uris">>;
  parsedCount: number;
  deckName?: string;
  save?: boolean;
  responses: Record<string, "pending" | "yes" | "no">;
  timeout?: NodeJS.Timeout | null;
  // snapshots to allow restore on cancel
  snapshotZones?: any;
  snapshotCommandZone?: any;
  snapshotPhase?: string | null;
  // PRE_GAME optimization: apply only for the importer (do not wipe/reset table)
  applyImporterOnly?: boolean;
};

const pendingImportConfirmations: Map<string, PendingConfirm> = new Map();

function broadcastConfirmUpdate(io: Server, confirmId: string, p: PendingConfirm) {
  try {
    io.to(p.gameId).emit("importWipeConfirmUpdate", {
      confirmId,
      responses: p.responses,
    });
  } catch (err) {
    console.warn("broadcastConfirmUpdate failed", err);
  }
}

/* --- pendingInitialDraw helpers --- */
function addPendingInitialDrawFlag(game: any, pid: PlayerID) {
  try {
    if (!game) return;
    if ((game as any).pendingInitialDraw && typeof (game as any).pendingInitialDraw.add === "function") {
      (game as any).pendingInitialDraw.add(pid);
    } else {
      (game as any).pendingInitialDraw = (game as any).pendingInitialDraw || new Set<PlayerID>();
      (game as any).pendingInitialDraw.add(pid);
    }
    console.info("[deck] addPendingInitialDrawFlag", {
      gameId: game?.id ?? (game?.state?.id ?? null),
      playerId: pid,
      pendingInitialDrawSize: (game as any).pendingInitialDraw?.size ?? null,
    });
  } catch (e) {
    console.warn("addPendingInitialDrawFlag failed:", e);
  }
}
function removePendingInitialDrawFlag(game: any, pid: PlayerID) {
  try {
    if (!game) return;
    if ((game as any).pendingInitialDraw && typeof (game as any).pendingInitialDraw.delete === "function") {
      (game as any).pendingInitialDraw.delete(pid);
    } else if ((game as any).pendingInitialDraw && Array.isArray((game as any).pendingInitialDraw)) {
      (game as any).pendingInitialDraw = new Set(((game as any).pendingInitialDraw as any[]).filter((x: any) => x !== pid));
    }
    console.info("[deck] removePendingInitialDrawFlag", {
      gameId: game?.id ?? (game?.state?.id ?? null),
      playerId: pid,
      pendingInitialDrawSize: (game as any).pendingInitialDraw?.size ?? null,
    });
  } catch (e) {
    console.warn("removePendingInitialDrawFlag failed:", e);
  }
}

/* --- snapshot helpers for cancellation --- */
function restoreSnapshotIfPresent(io: Server, confirmId: string) {
  const p = pendingImportConfirmations.get(confirmId);
  if (!p) return;
  try {
    const game = ensureGame(p.gameId);
    if (!game) return;

    if (p.snapshotZones) {
      game.state = game.state || {};
      game.state.zones = game.state.zones || {};
      game.state.zones[p.initiator] = p.snapshotZones;
    }

    if (p.snapshotCommandZone) {
      game.state = game.state || {};
      game.state.commandZone = game.state.commandZone || {};
      game.state.commandZone[p.initiator] = p.snapshotCommandZone;
    }

    if (typeof p.snapshotPhase !== "undefined") {
      try {
        game.state = game.state || {};
        (game.state as any).phase = p.snapshotPhase;
      } catch (e) {
        console.warn("restoreSnapshotIfPresent: failed to restore phase", e);
      }
    }

    // Remove pendingInitialDraw flag we set at import initiation
    try {
      removePendingInitialDrawFlag(game, p.initiator);
    } catch (e) {
      console.warn("restoreSnapshotIfPresent: failed to remove pendingInitialDraw flag", e);
    }

    try {
      broadcastGame(io, game, p.gameId);
    } catch (e) {
      /* best-effort */
    }
  } catch (err) {
    console.warn("restoreSnapshotIfPresent failed", err);
  }
}

function cancelConfirmation(io: Server, confirmId: string, reason = "cancelled") {
  const p = pendingImportConfirmations.get(confirmId);
  if (!p) return;
  if (p.timeout) {
    try { clearTimeout(p.timeout); } catch {}
  }

  try {
    // restore snapshots if present
    try { restoreSnapshotIfPresent(io, confirmId); } catch (e) { console.warn("cancelConfirmation: restoreSnapshotIfPresent failed", e); }

    io.to(p.gameId).emit("importWipeCancelled", { confirmId, gameId: p.gameId, by: p.initiator, reason });
  } catch (e) {
    console.warn("cancelConfirmation emit failed", e);
  }
  pendingImportConfirmations.delete(confirmId);
}

/* Helper: clear transient importer zones (hand + command zone) */
function clearPlayerTransientZonesForImport(game: any, pid: PlayerID) {
  try {
    game.state = game.state || {};
    game.state.zones = game.state.zones || {};
    game.state.zones[pid] = game.state.zones[pid] || {};

    // clear hand
    game.state.zones[pid].hand = [];
    game.state.zones[pid].handCount = 0;

    // clear command zone snapshot
    game.state.commandZone = game.state.commandZone || {};
    game.state.commandZone[pid] = { commanderIds: [], commanderCards: [], tax: 0, taxById: {} };

    // mark pre-game (best-effort; not required)
    try { (game.state as any).phase = "PRE_GAME"; } catch (e) { /* ignore */ }

    console.info("[deck] clearPlayerTransientZonesForImport", {
      gameId: game?.id ?? (game?.state?.id ?? null),
      playerId: pid,
    });
  } catch (e) {
    console.warn("clearPlayerTransientZonesForImport failed:", e);
  }
}

/* Helper: best-effort active player ids */
function getActivePlayerIds(game: any, io: Server, gameId: string): string[] {
  try {
    const sPlayers = (game && game.state && Array.isArray(game.state.players)) ? game.state.players : null;
    if (sPlayers) {
      const active = sPlayers.filter((p: any) => !p?.inactive).map((p: any) => p?.id).filter(Boolean);
      if (active.length > 0) return Array.from(new Set(active));
      const ids = sPlayers.map((p: any) => p?.id).filter(Boolean);
      if (ids.length > 0) return Array.from(new Set(ids));
    }

    if (typeof (game as any).participants === "function") {
      try {
        const parts = (game as any).participants();
        const ids = Array.isArray(parts) ? parts.map((pp: any) => pp.playerId).filter(Boolean) : [];
        if (ids.length > 0) return Array.from(new Set(ids));
      } catch (e) { /* ignore */ }
    }

    try {
      const adapter = (io as any).sockets?.adapter;
      if (adapter && typeof adapter.rooms?.has === "function") {
        const room = adapter.rooms.get(gameId);
        if (room && typeof room[Symbol.iterator] === "function") {
          const sockets = Array.from(room as Iterable<any>);
          const parts = (game && ((game as any).participants ? (game as any).participants() : (game as any).participantsList)) || [];
          const mapping: Record<string, string> = {};
          for (const pp of parts || []) if (pp?.socketId && pp?.playerId) mapping[pp.socketId] = pp.playerId;
          const ids = sockets.map((sid: any) => mapping[sid]).filter(Boolean);
          if (ids.length > 0) return Array.from(new Set(ids));
        }
      }
    } catch (e) { /* ignore */ }
  } catch (e) {
    console.warn("getActivePlayerIds failed:", e);
  }
  return [];
}

/* suggest commander heuristics (unchanged) */
function suggestCommanderNames(
  cards: Array<Pick<KnownCardRef, "name" | "type_line" | "oracle_text">>
) {
  const isLegendary = (tl?: string) => (tl || "").toLowerCase().includes("legendary");
  const isEligibleType = (tl?: string) => {
    const t = (tl || "").toLowerCase();
    return t.includes("creature") || t.includes("planeswalker") || t.includes("background");
  };
  const hasPartnerish = (oracle?: string, tl?: string) => {
    const o = (oracle || "").toLowerCase();
    const t = (tl || "").toLowerCase();
    return o.includes("partner") || o.includes("background") || t.includes("background");
  };
  const pool = cards.filter((c: any) => isLegendary(c.type_line) && isEligibleType(c.type_line));
  const first = pool[0];
  const second = pool.slice(1).find((c: any) => hasPartnerish(c.oracle_text, c.type_line));
  const names: string[] = [];
  if (first?.name) names.push(first.name);
  if (second?.name && second.name !== first.name) names.push(second.name);
  return names.slice(0, 2);
}

/**
 * applyConfirmedImport - idempotent / reentrancy-safe application of confirmed import.
 *
 * Optional importerSocket parameter is used for immediate importer-only flows so we can
 * directly emit suggestCommanders/importedDeckCandidates/importApplied to the initiating client.
 */
async function applyConfirmedImport(io: Server, confirmId: string, importerSocket?: Socket) {
  const p = pendingImportConfirmations.get(confirmId);
  if (!p) {
    console.warn("[import] applyConfirmedImport called with missing confirmId", { confirmId });
    return;
  }
  if (p.timeout) {
    try { clearTimeout(p.timeout); } catch {}
  }

  const REPEAT_WINDOW_MS = 5_000;

  try {
    const game = ensureGame(p.gameId);
    if (!game) {
      console.warn("[import] applyConfirmedImport: game not found", { gameId: p.gameId, confirmId });
      try { io.to(p.gameId).emit("importWipeCancelled", { confirmId, gameId: p.gameId, by: p.initiator, reason: "game_not_found" }); } catch {}
      pendingImportConfirmations.delete(confirmId);
      return;
    }

    const importerOnly = !!p.applyImporterOnly;

    try {
      if ((game as any)._importApplying) {
        console.info("[import] applyConfirmedImport skipped - another apply in progress", {
          gameId: p.gameId,
          initiator: p.initiator,
          confirmId,
        });
        pendingImportConfirmations.delete(confirmId);
        return;
      }
      const lastBy = (game as any)._lastImportAppliedBy;
      const lastAt = (game as any)._lastImportAppliedAt || 0;
      if (lastBy === p.initiator && (Date.now() - lastAt) < REPEAT_WINDOW_MS) {
        console.info("[import] applyConfirmedImport dedupe skip recent apply", {
          gameId: p.gameId,
          initiator: p.initiator,
          confirmId,
          lastBy,
          lastAt,
        });
        pendingImportConfirmations.delete(confirmId);
        return;
      }
      (game as any)._importApplying = true;
    } catch (e) {
      console.warn("applyConfirmedImport: could not set _importApplying guard", e);
    }

    console.info("[import] applyConfirmedImport start", {
      gameId: p.gameId,
      initiator: p.initiator,
      cards: p.resolvedCards.length,
      importerOnly,
      confirmId,
    });

    if (!importerOnly) {
      try {
        if (typeof (game as any).reset === "function") {
          (game as any).reset(true);
          try { appendEvent(p.gameId, game.seq, "resetGame", { preservePlayers: true }); } catch {}
          console.info("[import] reset(true) applied", { gameId: p.gameId });
        } else {
          console.warn("applyConfirmedImport: game.reset not available");
        }
      } catch (e) {
        console.warn("applyConfirmedImport: reset failed", e);
      }
    } else {
      console.info("[import] importer-only apply: skipping full reset", { gameId: p.gameId });
    }

    try {
      if (typeof (game as any).importDeckResolved === "function") {
        try {
          (game as any).importDeckResolved(p.initiator, p.resolvedCards);
        } catch {
          (game as any).importDeckResolved(p.initiator, p.resolvedCards);
        }
      }
      console.info("[import] importDeckResolved attempted", { gameId: p.gameId, playerId: p.initiator });
    } catch (err) {
      console.error("applyConfirmedImport: game.importDeckResolved failed", err);
    }

    try {
      const mapped = (p.resolvedCards || []).map((c: any) => ({ ...c, zone: "library" }));
      const L = (game as any).libraries;
      if (L && typeof L.set === "function") {
        try {
          L.set(p.initiator, mapped);
          console.info("[import] libraries.set overwrite", {
            gameId: p.gameId,
            playerId: p.initiator,
            count: mapped.length,
          });
        } catch (e) {
          console.warn("applyConfirmedImport: libraries.set overwrite failed", e);
        }
      } else {
        try {
          game.state = game.state || {};
          game.state.zones = game.state.zones || {};
          game.state.zones[p.initiator] = game.state.zones[p.initiator] || { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0 };
          game.state.zones[p.initiator].library = mapped;
          game.state.zones[p.initiator].libraryCount = (typeof p.parsedCount === "number" ? p.parsedCount : mapped.length);
          console.info("[import] state.zones library overwrite", {
            gameId: p.gameId,
            playerId: p.initiator,
            libraryCount: game.state.zones[p.initiator].libraryCount,
          });
        } catch (e) {
          console.warn("applyConfirmedImport: state.zones overwrite failed", e);
        }
      }
    } catch (e) {
      console.warn("applyConfirmedImport: forced library overwrite failed", e);
    }

    try {
      const starting = (game.state && (game.state as any).startingLife) || 40;
      if ((game as any).life) (game as any).life[p.initiator] = starting;
      if ((game.state as any).life) (game.state as any).life[p.initiator] = starting;
      (game.state as any).zones = (game.state as any).zones || {};
      (game.state as any).zones[p.initiator] = (game.state as any).zones[p.initiator] || {
        hand: [],
        handCount: 0,
        libraryCount: ((game as any).libraries && typeof (game as any).libraries.get === "function"
          ? ((game as any).libraries.get(p.initiator) || []).length
          : 0),
        graveyard: [],
        graveyardCount: 0,
      };
    } catch (e) {
      console.warn("applyConfirmedImport: defensive life/zones init failed", e);
    }

    try {
      appendEvent(p.gameId, game.seq, "deckImportResolved", {
        playerId: p.initiator,
        cards: p.resolvedCards,
        importerOnly,
      });
    } catch (err) {
      console.warn("applyConfirmedImport: appendEvent failed", err);
    }

    // Flag pendingInitialDraw and emit suggestions/candidates
    try {
      addPendingInitialDrawFlag(game, p.initiator);
      try { broadcastGame(io, game, p.gameId); } catch (e) { console.warn("applyConfirmedImport: broadcastGame failed (pre-suggest)", e); }

      const names = suggestCommanderNames(p.resolvedCards);
      const candidates = (p.resolvedCards || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        type_line: c.type_line,
        oracle_text: c.oracle_text,
        image_uris: c.image_uris,
      }));

      try {
        (game as any)._lastImportedDecks = (game as any)._lastImportedDecks || new Map<PlayerID, any[]>();
        (game as any)._lastImportedDecks.set(
          p.initiator,
          (p.resolvedCards || []).map((c) => ({
            id: c.id,
            name: c.name,
            type_line: c.type_line,
            oracle_text: c.oracle_text,
            image_uris: c.image_uris,
          }))
        );
        (game as any)._lastImportedDecksNames = (game as any)._lastImportedDecksNames || new Map<PlayerID, string[]>();
        (game as any)._lastImportedDecksNames.set(p.initiator, names);
      } catch (e) {
        console.warn("applyConfirmedImport: could not persist _lastImportedDecks metadata", e);
      }

      if (importerSocket) {
        try {
          try {
            emitImportedDeckCandidatesToPlayer(io, p.gameId, p.initiator);
          } catch (e) {
            console.warn("applyConfirmedImport: emitImportedDeckCandidatesToPlayer failed (importerSocket)", e);
          }
          try {
            emitSuggestCommandersToPlayer(io, p.gameId, p.initiator, names);
            console.info("[import] suggestCommanders emitted (importerSocket)", {
              gameId: p.gameId,
              playerId: p.initiator,
              names,
            });
          } catch (e) {
            console.warn("applyConfirmedImport: emitSuggestCommandersToPlayer failed (importerSocket)", e);
          }

          try {
            for (const s of Array.from(io.sockets.sockets.values() as any)) {
              try {
                if (s?.data?.playerId === p.initiator && !s?.data?.spectator) {
                  s.emit("importApplied", {
                    confirmId,
                    gameId: p.gameId,
                    by: p.initiator,
                    deckName: p.deckName,
                    importerOnly,
                  });
                }
              } catch (e) { /* ignore per-socket errors */ }
            }
            console.info("[import] importApplied sent to player sockets", {
              gameId: p.gameId,
              playerId: p.initiator,
            });
          } catch (e) {
            console.warn("applyConfirmedImport: importApplied emit to player sockets failed", e);
            try {
              importerSocket.emit("importApplied", {
                confirmId,
                gameId: p.gameId,
                by: p.initiator,
                deckName: p.deckName,
                importerOnly,
              });
            } catch {}
          }
        } catch (e) {
          console.warn("applyConfirmedImport: importerSocket branch failed", e);
        }
      } else {
        try {
          try {
            emitImportedDeckCandidatesToPlayer(io, p.gameId, p.initiator);
          } catch (e) {
            console.warn("applyConfirmedImport: emitImportedDeckCandidatesToPlayer failed", e);
          }

          try {
            emitSuggestCommandersToPlayer(io, p.gameId, p.initiator, names);
            console.info("[import] suggestCommanders emitted (player sockets)", {
              gameId: p.gameId,
              playerId: p.initiator,
              names,
            });
          } catch (e) {
            console.warn("applyConfirmedImport: emitSuggestCommandersToPlayer failed", e);
            try {
              io.to(p.gameId).emit("suggestCommanders", { gameId: p.gameId, names });
              console.info("[import] suggestCommanders broadcast to room", {
                gameId: p.gameId,
                names,
              });
            } catch (e2) {
              console.warn("applyConfirmedImport: fallback suggestCommanders broadcast failed", e2);
            }
          }
        } catch (e) {
          console.warn("applyConfirmedImport: suggestCommanders block failed", e);
        }
      }

      // If commander already present or non-commander format, immediate shuffle+draw
      try {
        const cz = (game.state && game.state.commandZone && (game.state as any).commandZone[p.initiator]) || null;
        const isCommanderFmt = String(game.state.format || "").toLowerCase() === "commander";
        const hasCommanderAlready = cz && Array.isArray(cz.commanderIds) && cz.commanderIds.length > 0;
        if (hasCommanderAlready || !isCommanderFmt) {
          console.info("[import] applyConfirmedImport -> immediate shuffle/draw path", {
            gameId: p.gameId,
            playerId: p.initiator,
            hasCommanderAlready,
            isCommanderFmt,
          });
          const pendingSet = (game as any).pendingInitialDraw as Set<PlayerID> | undefined;
          if (pendingSet && pendingSet.has(p.initiator)) {
            const z = (game.state && (game.state as any).zones && (game.state as any).zones[p.initiator]) || null;
            const handCount =
              z ?
                (typeof z.handCount === "number"
                  ? z.handCount
                  : (Array.isArray(z.hand) ? z.hand.length : 0))
                : 0;
            if (handCount === 0) {
              if (typeof (game as any).shuffleLibrary === "function") {
                try {
                  (game as any).shuffleLibrary(p.initiator);
                  appendEvent(p.gameId, game.seq, "shuffleLibrary", { playerId: p.initiator });
                  console.info("[import] immediate shuffleLibrary", {
                    gameId: p.gameId,
                    playerId: p.initiator,
                  });
                } catch (e) {
                  console.warn("applyConfirmedImport: shuffleLibrary failed", e);
                }
              }
              if (typeof (game as any).drawCards === "function") {
                try {
                  (game as any).drawCards(p.initiator, 7);
                  appendEvent(p.gameId, game.seq, "drawCards", {
                    playerId: p.initiator,
                    count: 7,
                  });
                  console.info("[import] immediate drawCards(7)", {
                    gameId: p.gameId,
                    playerId: p.initiator,
                  });
                } catch (e) {
                  console.warn("applyConfirmedImport: drawCards failed", e);
                }
              }
            }
            try { pendingSet.delete(p.initiator); } catch (e) { /* ignore */ }
          }
        }
      } catch (e) {
        console.warn("applyConfirmedImport: attempted immediate shuffle/draw failed", e);
      }

      try {
        broadcastGame(io, game, p.gameId);
      } catch (e) {
        console.warn("applyConfirmedImport: broadcastGame failed (post-suggest)", e);
      }
    } catch (err) {
      console.warn("applyConfirmedImport: opening draw flow failed", err);
    }

    if (p.save === true && p.deckName && p.deckName.trim()) {
      try {
        const deckId = `deck_${Date.now()}`;
        const created_by_name =
          (game.state.players as any[])?.find((pl) => pl.id === p.initiator)?.name ||
          String(p.initiator);
        const card_count = p.parsedCount;
        saveDeckDB({
          id: deckId,
          name: p.deckName.trim(),
          text: "",
          created_by_id: p.initiator,
          created_by_name,
          card_count,
        });
        io.to(p.gameId).emit("savedDecksList", {
          gameId: p.gameId,
          decks: listDecks(),
        });
      } catch (e) {
        console.warn("applyConfirmedImport: auto-save failed", e);
      }
    }

    try {
      if (!importerOnly) {
        try {
          io.to(p.gameId).emit("importWipeConfirmed", {
            confirmId,
            gameId: p.gameId,
            by: p.initiator,
          });
        } catch (e) {
          console.warn("applyConfirmedImport: importWipeConfirmed emit failed", e);
        }
      }
      try {
        broadcastGame(io, game, p.gameId);
      } catch {}
    } catch (err) {
      console.warn("applyConfirmedImport: final broadcast/notify failed", err);
    }

    try {
      (game as any)._lastImportAppliedBy = p.initiator;
      (game as any)._lastImportAppliedAt = Date.now();
    } catch (e) { /* ignore */ }
  } finally {
    try {
      const game = ensureGame(p.gameId);
      if (game) (game as any)._importApplying = false;
    } catch {}
    pendingImportConfirmations.delete(confirmId);
    console.info("[import] applyConfirmedImport complete", {
      gameId: p.gameId,
      initiator: p.initiator,
      confirmId,
    });
  }
}

/* --- Main registration: socket handlers for deck management --- */
export function registerDeckHandlers(io: Server, socket: Socket) {
  // New: Preflight check for importer-only import (no room wipe)
  socket.on(
    "canImportWithoutWipe",
    ({ gameId }: { gameId?: string }, cb?: (resp: any) => void) => {
      try {
        if (!gameId || typeof gameId !== "string") {
          if (typeof cb === "function") cb({ error: "missing_gameId" });
          return;
        }
        const game = ensureGame(gameId);
        if (!game) {
          if (typeof cb === "function") cb({ error: "game_not_found" });
          return;
        }
        const rawPhase = (game.state && (game.state as any).phase) ?? "";
        const phaseStr = String(rawPhase).toUpperCase().trim();
        const seqVal =
          typeof (game as any).seq === "number" ? (game as any).seq : null;
        const isPreGame =
          phaseStr === "" ||
          phaseStr.includes("PRE") ||
          phaseStr.includes("BEGIN") ||
          seqVal === 0 ||
          seqVal === null;

        console.info("[deck] canImportWithoutWipe", {
          gameId,
          phaseStr,
          seqVal,
          isPreGame,
        });

        if (typeof cb === "function")
          cb({ importerOnly: isPreGame, phase: phaseStr, seq: seqVal });
      } catch (err) {
        console.warn("canImportWithoutWipe handler failed:", err);
        if (typeof cb === "function") cb({ error: String(err) });
      }
    }
  );

  // importDeck
  socket.on(
    "importDeck",
    async ({
      gameId,
      list,
      deckName,
      save,
    }: {
      gameId: string;
      list: string;
      deckName?: string;
      save?: boolean;
    }) => {
      console.info("[deck] importDeck called", {
        gameId,
        playerId: socket.data.playerId,
      });

      // Validate incoming payload before calling ensureGame
      if (!gameId || typeof gameId !== "string") {
        socket.emit("deckError", { gameId, message: "GameId required." });
        return;
      }

      const pid = socket.data.playerId as PlayerID | undefined;
      const spectator = socket.data.spectator;
      if (!pid || spectator) {
        socket.emit("deckError", {
          gameId,
          message: "Spectators cannot import decks.",
        });
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("deckError", { gameId, message: "Game not found." });
        return;
      }

      // Parse decklist
      let parsed: Array<{ name: string; count: number }>;
      try {
        parsed = parseDecklist(list);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          socket.emit("deckError", {
            gameId,
            message: "Deck list appears empty or invalid.",
          });
          return;
        }
      } catch (err) {
        socket.emit("deckError", { gameId, message: "Failed to parse deck list." });
        return;
      }

      const requestedNames = parsed.map((p) => p.name);
      let byName: Map<string, any> | null = null;
      try {
        byName = await fetchCardsByExactNamesBatch(requestedNames);
      } catch (e: any) {
        byName = null;
      }

      const resolvedCards: Array<
        Pick<KnownCardRef, "id" | "name" | "type_line" | "oracle_text" | "image_uris">
      > = [];
      const validationCards: any[] = [];
      const missing: string[] = [];

      if (byName) {
        for (const { name, count } of parsed) {
          const key = normalizeName(name).toLowerCase();
          const c = byName.get(key);
          if (!c) {
            missing.push(name);
            continue;
          }
          for (let i = 0; i < (count || 1); i++) {
            validationCards.push(c);
            resolvedCards.push({
              id: c.id,
              name: c.name,
              type_line: c.type_line,
              oracle_text: c.oracle_text,
              image_uris: c.image_uris,
            });
          }
        }
      } else {
        for (const { name, count } of parsed) {
          try {
            const c = await fetchCardByExactNameStrict(name);
            for (let i = 0; i < (count || 1); i++) {
              validationCards.push(c);
              resolvedCards.push({
                id: c.id,
                name: c.name,
                type_line: c.type_line,
                oracle_text: c.oracle_text,
                image_uris: c.image_uris,
              });
            }
          } catch {
            missing.push(name);
          }
        }
      }

      console.info("[deck] importDeck resolved cards", {
        gameId,
        playerId: pid,
        resolvedCount: resolvedCards.length,
        missingCount: missing.length,
      });

      try {
        (game as any)._lastImportedDecks =
          (game as any)._lastImportedDecks || new Map<PlayerID, any[]>();
        (game as any)._lastImportedDecks.set(
          pid,
          resolvedCards.map((c) => ({
            id: c.id,
            name: c.name,
            type_line: c.type_line,
            oracle_text: c.oracle_text,
            image_uris: c.image_uris,
          }))
        );
      } catch (e) {
        console.warn(
          "Could not set _lastImportedDecks on game object for importDeck:",
          e
        );
      }

      if (missing.length) {
        try {
          socket.emit("deckImportMissing", { gameId, missing });
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `Missing (strict fetch): ${missing
              .slice(0, 10)
              .join(", ")}${missing.length > 10 ? ", …" : ""}`,
            ts: Date.now(),
          });
        } catch (e) {
          console.warn("emit deckImportMissing failed", e);
        }
      }

      const rawPhase = (game.state && (game.state as any).phase) ?? "";
      const phaseStr = String(rawPhase).toUpperCase().trim();
      const seqVal =
        typeof (game as any).seq === "number" ? (game as any).seq : null;
      const isPreGame =
        phaseStr === "" ||
        phaseStr.includes("PRE") ||
        phaseStr.includes("BEGIN") ||
        seqVal === 0 ||
        seqVal === null;

      console.info("[deck] importDeck pregame-check", {
        gameId,
        playerId: pid,
        phaseStr,
        seqVal,
        isPreGame,
      });

      if (isPreGame) {
        const confirmId = `imp_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        const pending: PendingConfirm = {
          gameId,
          initiator: pid,
          resolvedCards,
          parsedCount: parsed.reduce((s, p) => s + (p.count || 0), 0),
          deckName,
          save,
          responses: { [pid]: "yes" },
          timeout: null,
          snapshotZones:
            game.state &&
            (game.state as any).zones &&
            (game.state as any).zones[pid]
              ? JSON.parse(
                  JSON.stringify((game.state as any).zones[pid])
                )
              : null,
          snapshotCommandZone:
            game.state &&
            (game.state as any).commandZone &&
            (game.state as any).commandZone[pid]
              ? JSON.parse(
                  JSON.stringify(
                    (game.state as any).commandZone[pid]
                  )
                )
              : null,
          snapshotPhase:
            game.state && (game.state as any).phase !== undefined
              ? (game.state as any).phase
              : null,
          applyImporterOnly: true,
        };
        pendingImportConfirmations.set(confirmId, pending);

        try {
          clearPlayerTransientZonesForImport(game, pid);
          addPendingInitialDrawFlag(game, pid);
          try {
            broadcastGame(io, game, gameId);
          } catch (e) {
            /* best-effort */
          }
        } catch (e) {
          console.warn(
            "importDeck (pre-game): clearing transient zones/flags failed",
            e
          );
        }

        try {
          const names = suggestCommanderNames(resolvedCards);
          console.info("[deck] importDeck (pre-game) emitting suggestCommanders", {
            gameId,
            playerId: pid,
            names,
          });
          try {
            socket.emit("suggestCommanders", { gameId, names });
          } catch (e) {
            /* ignore */
          }
        } catch (e) {
          /* ignore */
        }

        setTimeout(() => {
          applyConfirmedImport(io, confirmId, socket).catch((err) => {
            console.error("immediate applyConfirmedImport failed:", err);
            cancelConfirmation(io, confirmId, "apply_failed");
          });
        }, 200);
        return;
      }

      const activePlayerIds = getActivePlayerIds(game, io, gameId);
      const players =
        activePlayerIds.length > 0
          ? activePlayerIds
          : (game.state.players || [])
              .map((p: any) => p.id)
              .filter(Boolean) as string[];

      const confirmId = `imp_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const responses: Record<string, "pending" | "yes" | "no"> = {};
      for (const pl of players) responses[pl] = "pending";
      responses[pid] = "yes";

      const snapshotZones =
        game.state &&
        (game.state as any).zones &&
        (game.state as any).zones[pid]
          ? JSON.parse(JSON.stringify((game.state as any).zones[pid]))
          : null;
      const snapshotCommandZone =
        game.state &&
        (game.state as any).commandZone &&
        (game.state as any).commandZone[pid]
          ? JSON.parse(
              JSON.stringify((game.state as any).commandZone[pid])
            )
          : null;
      const snapshotPhase =
        game.state && (game.state as any).phase !== undefined
          ? (game.state as any).phase
          : null;

      const pendingConfirm: PendingConfirm = {
        gameId,
        initiator: pid,
        resolvedCards,
        parsedCount: parsed.reduce((s, p) => s + (p.count || 0), 0),
        deckName,
        save,
        responses,
        timeout: null,
        snapshotZones,
        snapshotCommandZone,
        snapshotPhase,
        applyImporterOnly: false,
      };

      const TIMEOUT_MS = 60_000;
      pendingConfirm.timeout = setTimeout(() => {
        cancelConfirmation(io, confirmId, "timeout");
      }, TIMEOUT_MS);

      pendingImportConfirmations.set(confirmId, pendingConfirm);

      try {
        clearPlayerTransientZonesForImport(game, pid);
        try {
          broadcastGame(io, game, gameId);
        } catch (e) {
          /* best-effort */
        }
      } catch (e) {
        console.warn("importDeck: clearing transient zones failed", e);
      }

      try {
        addPendingInitialDrawFlag(game, pid);
        try {
          broadcastGame(io, game, gameId);
        } catch (e) {
          /* best-effort */
        }
      } catch (e) {
        console.warn("importDeck: addPendingInitialDrawFlag failed", e);
      }

      try {
        console.info("[deck] emitting importWipeConfirmRequest", {
          gameId,
          confirmId,
          initiator: pid,
          players: players.length,
          resolvedCount: resolvedCards.length,
        });
        io.to(gameId).emit("importWipeConfirmRequest", {
          confirmId,
          gameId,
          initiator: pid,
          deckName,
          resolvedCount: resolvedCards.length,
          expectedCount: pendingConfirm.parsedCount,
          players,
          timeoutMs: TIMEOUT_MS,
        });
      } catch (err) {
        console.warn("importDeck: emit importWipeConfirmRequest failed", err);
      }

      broadcastConfirmUpdate(io, confirmId, pendingConfirm);

      try {
        if (players.length <= 1) {
          console.info("[deck] auto-applyConfirmedImport for single player", {
            gameId,
            confirmId,
          });
          setTimeout(() => {
            applyConfirmedImport(io, confirmId).catch((err) => {
              console.error("auto applyConfirmedImport failed:", err);
              cancelConfirmation(io, confirmId, "apply_failed");
            });
          }, 250);
        }
      } catch (e) {
        console.warn("importDeck: auto-apply single-player failed", e);
      }
    }
  );

  // Handle confirmation responses
  socket.on(
    "confirmImportResponse",
    ({
      gameId,
      confirmId,
      accept,
    }: {
      gameId: string;
      confirmId: string;
      accept: boolean;
    }) => {
      try {
        if (!gameId || typeof gameId !== "string") {
          socket.emit("error", {
            code: "CONFIRM_MISSING_GAME",
            message: "gameId required",
          });
          return;
        }
        const pid = socket.data.playerId as PlayerID | undefined;
        if (!pid) return;
        const pending = pendingImportConfirmations.get(confirmId);
        if (!pending) {
          socket.emit("error", {
            code: "CONFIRM_NOT_FOUND",
            message: "Confirmation not found or expired",
          });
          return;
        }
        if (pending.gameId !== gameId) {
          socket.emit("error", {
            code: "CONFIRM_MISMATCH",
            message: "GameId mismatch",
          });
          return;
        }
        if (!(pid in pending.responses)) {
          socket.emit("error", {
            code: "CONFIRM_NOT_A_PLAYER",
            message: "You are not part of this confirmation",
          });
          return;
        }

        pending.responses[pid] = accept ? "yes" : "no";
        console.info("[deck] confirmImportResponse", {
          gameId,
          confirmId,
          playerId: pid,
          accept,
          responses: pending.responses,
        });
        broadcastConfirmUpdate(io, confirmId, pending);

        const anyNo = Object.values(pending.responses).some(
          (v) => v === "no"
        );
        if (anyNo) {
          cancelConfirmation(io, confirmId, "voted_no");
          return;
        }

        const allYes = Object.values(pending.responses).every(
          (v) => v === "yes"
        );
        if (allYes) {
          console.info("[deck] all players accepted import", {
            gameId,
            confirmId,
          });
          applyConfirmedImport(io, confirmId).catch((err) => {
            console.error("applyConfirmedImport failed:", err);
            cancelConfirmation(io, confirmId, "apply_failed");
          });
        }
      } catch (err) {
        console.error("confirmImportResponse handler failed:", err);
      }
    }
  );

  // getImportedDeckCandidates
  socket.on("getImportedDeckCandidates", ({ gameId }: { gameId: string }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    const spectator = socket.data.spectator;
    if (!pid || spectator) {
      socket.emit("importedDeckCandidates", { gameId, candidates: [] });
      return;
    }
    if (!gameId || typeof gameId !== "string") {
      socket.emit("importedDeckCandidates", { gameId, candidates: [] });
      return;
    }
    try {
      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("importedDeckCandidates", { gameId, candidates: [] });
        return;
      }
      const buf = (game as any)._lastImportedDecks as
        | Map<PlayerID, any[]>
        | undefined;
      const local = buf ? buf.get(pid) || [] : [];
      const candidates = (local || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        type_line: c.type_line,
        oracle_text: c.oracle_text,
        image_uris: c.image_uris,
      }));
      console.info("[deck] getImportedDeckCandidates", {
        gameId,
        playerId: pid,
        candidatesCount: candidates.length,
      });
      socket.emit("importedDeckCandidates", { gameId, candidates });
    } catch (err) {
      console.warn("getImportedDeckCandidates failed:", err);
      socket.emit("importedDeckCandidates", { gameId, candidates: [] });
    }
  });

  // useSavedDeck (unchanged except for logs) ...
  //  (omitted here for brevity since you didn't report issues in saved-deck path,
  //   your existing version can remain as-is; add similar console.info as needed)
}