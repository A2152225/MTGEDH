/**
 * server/src/socket/deck.ts
 *
 * Full replacement for deck import / saved deck socket handlers.
 *
 * Behavior highlights:
 * - importDeck / useSavedDeck resolve card ids via batch Scryfall or individual fetch.
 * - Persist resolved import buffer on game object: game._lastImportedDecks (Map<PlayerID, card[]>).
 * - For multiplayer: emit importWipeConfirmRequest and collect unanimous consent.
 * - For solo OR PRE_GAME/BEGINNING phases: skip vote and immediately apply import for the importer only.
 * - applyConfirmedImport is idempotent and reentrancy-safe (game._importApplying, _lastImportAppliedAt).
 * - applyConfirmedImport populates authoritative libraries/zones if missing, flags pendingInitialDraw,
 *   and will immediately shuffle/draw the opening hand in these cases:
 *     - if the authoritative commandZone already contains commander ids (i.e. commander already set)
 *     - OR if the format is not 'commander' (no commander required)
 *
 * Additional change:
 * - When an import is initiated we now proactively unload (clear) the importer's
 *   transient zones that would be stale while the import/confirm modal is open:
 *     - clear hand and handCount
 *     - clear commander info in state.commandZone for that player
 *   We also set a pendingInitialDraw flag at import initiation. If the import is
 *   later cancelled, the pendingInitialDraw flag is removed. This ensures that
 *   when the player selects commanders (client calls setCommander) the server
 *   will see the pendingInitialDraw and perform shuffle+draw idempotently.
 *
 * Notes:
 * - This file is written to be a drop-in replacement on the Lotsofstuffhappened branch.
 * - It is conservative and defensive against different game implementations.
 */

import type { Server, Socket } from "socket.io";
import {
  parseDecklist,
  fetchCardsByExactNamesBatch,
  fetchCardByExactNameStrict,
} from "../services/scryfall";
import { ensureGame, broadcastGame } from "./util";
import { appendEvent } from "../db";
import {
  saveDeck as saveDeckDB,
  listDecks,
  getDeck as getDeckDB,
  renameDeck,
  deleteDeck,
} from "../db/decks";
import type { KnownCardRef, PlayerID } from "../../shared/src";

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

function removePendingInitialDrawFlag(game: any, pid: PlayerID) {
  try {
    if (!game) return;
    if ((game as any).pendingInitialDraw && typeof (game as any).pendingInitialDraw.delete === "function") {
      (game as any).pendingInitialDraw.delete(pid);
    } else if ((game as any).pendingInitialDraw && Array.isArray((game as any).pendingInitialDraw)) {
      // older shape fallback
      (game as any).pendingInitialDraw = new Set(((game as any).pendingInitialDraw as any[]).filter((x: any) => x !== pid));
    }
  } catch (e) {
    console.warn("removePendingInitialDrawFlag failed:", e);
  }
}

function addPendingInitialDrawFlag(game: any, pid: PlayerID) {
  try {
    if (!game) return;
    if ((game as any).pendingInitialDraw && typeof (game as any).pendingInitialDraw.add === "function") {
      (game as any).pendingInitialDraw.add(pid);
    } else {
      (game as any).pendingInitialDraw = (game as any).pendingInitialDraw || new Set<PlayerID>();
      (game as any).pendingInitialDraw.add(pid);
    }
  } catch (e) {
    console.warn("addPendingInitialDrawFlag failed:", e);
  }
}

function cancelConfirmation(io: Server, confirmId: string, reason = "cancelled") {
  const p = pendingImportConfirmations.get(confirmId);
  if (!p) return;
  if (p.timeout) {
    try { clearTimeout(p.timeout); } catch {}
  }
  try {
    // Remove the pendingInitialDraw flag if it was set at import initiation
    try {
      const game = ensureGame(p.gameId);
      if (game) {
        removePendingInitialDrawFlag(game, p.initiator);
        // Broadcast updated authoritative game so clients stop showing cleared transient zones
        try { broadcastGame(io, game, p.gameId); } catch (e) { /* best-effort */ }
      }
    } catch (e) { /* ignore */ }

    io.to(p.gameId).emit("importWipeCancelled", { confirmId, gameId: p.gameId, by: p.initiator, reason });
  } catch (e) {
    console.warn("cancelConfirmation emit failed", e);
  }
  pendingImportConfirmations.delete(confirmId);
}

/* Helper: clear transient zones for a player while import/confirm is pending.
   We purposely limit the clearing to hand and commandZone so we don't accidentally
   remove battlefield permanents owned by others. This makes the UI reflect that
   the import is in progress and prevents old commanders/hands from showing under the modal.
*/
function clearPlayerTransientZonesForImport(game: any, pid: PlayerID) {
  try {
    // Ensure zones object exists
    game.state = game.state || {};
    game.state.zones = game.state.zones || {};
    game.state.zones[pid] = game.state.zones[pid] || {};

    // Clear hand
    game.state.zones[pid].hand = [];
    game.state.zones[pid].handCount = 0;

    // Clear commander snapshot for that player so previous commanders don't show while import modal is open.
    game.state.commandZone = game.state.commandZone || {};
    game.state.commandZone[pid] = { commanderIds: [], commanderCards: [], tax: 0, taxById: {} };
  } catch (e) {
    console.warn("clearPlayerTransientZonesForImport failed:", e);
  }
}

/**
 * applyConfirmedImport - idempotent / reentrancy-safe application of confirmed import.
 *
 * Guards:
 *  - If game._importApplying === true, skip concurrent invocation.
 *  - If game._lastImportAppliedBy === initiator && within REPEAT_WINDOW_MS, skip repeat apply.
 *
 * Behaviors:
 *  - Calls game.reset(true) to clear state but preserve players if available.
 *  - Calls game.importDeckResolved(initiator, resolvedCards) if available (preferred).
 *  - Ensures libraries map or state.zones reflects the imported library for the initiating player.
 *  - Flags pendingInitialDraw for the importer so setCommander can shuffle/draw.
 *  - If commander is already present in authoritative state or format is not commander, immediately perform shuffle+draw (idempotent).
 *  - Emits suggestCommanders to the importer socket only (so gallery modal can open).
 *  - Broadcasts authoritative game state.
 */
async function applyConfirmedImport(io: Server, confirmId: string, importerSocket?: Socket) {
  const p = pendingImportConfirmations.get(confirmId);
  if (!p) return;
  if (p.timeout) {
    try { clearTimeout(p.timeout); } catch {}
  }

  const REPEAT_WINDOW_MS = 5_000;

  try {
    const game = ensureGame(p.gameId);
    if (!game) {
      io.to(p.gameId).emit("importWipeCancelled", { confirmId, gameId: p.gameId, by: p.initiator, reason: "game_not_found" });
      pendingImportConfirmations.delete(confirmId);
      return;
    }

    // Reentrancy / idempotency guards on game object
    try {
      if ((game as any)._importApplying) {
        console.info(`[import] applyConfirmedImport skipped because another apply in progress game=${p.gameId}`);
        pendingImportConfirmations.delete(confirmId);
        return;
      }
      const lastBy = (game as any)._lastImportAppliedBy;
      const lastAt = (game as any)._lastImportAppliedAt || 0;
      if (lastBy === p.initiator && (Date.now() - lastAt) < REPEAT_WINDOW_MS) {
        console.info(`[import] applyConfirmedImport dedupe skip recent apply game=${p.gameId} initiator=${p.initiator}`);
        pendingImportConfirmations.delete(confirmId);
        return;
      }
      (game as any)._importApplying = true;
    } catch (e) {
      console.warn("applyConfirmedImport: could not set _importApplying guard", e);
    }

    console.info(`[import] applyConfirmedImport start game=${p.gameId} initiator=${p.initiator} cards=${p.resolvedCards.length}`);

    // 1) Reset preserving players if available
    try {
      if (typeof (game as any).reset === "function") {
        (game as any).reset(true);
        try { appendEvent(p.gameId, game.seq, "resetGame", { preservePlayers: true }); } catch {}
        console.info(`[import] reset(true) applied for game=${p.gameId}`);
      } else {
        console.warn("applyConfirmedImport: game.reset not available");
      }
    } catch (e) {
      console.warn("applyConfirmedImport: reset failed", e);
    }

    // 2) Import into authoritative game state (preferred API)
    try {
      if (typeof (game as any).importDeckResolved === "function") {
        (game as any).importDeckResolved(p.initiator, p.resolvedCards);
      } else {
        // best-effort populate libraries map / state.zones
        try {
          const L = (game as any).libraries;
          if (L && typeof L.set === "function") {
            // if empty, set
            const existing = L.get(p.initiator) || [];
            if (!existing || existing.length === 0) {
              L.set(p.initiator, p.resolvedCards.map((c) => ({ ...c, zone: "library" })));
            }
          } else if ((game.state as any).zones) {
            (game.state as any).zones = (game.state as any).zones || {};
            (game.state as any).zones[p.initiator] = (game.state as any).zones[p.initiator] || { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0 };
            if ((!Array.isArray((game.state as any).zones[p.initiator].library) || (game.state as any).zones[p.initiator].library.length === 0) && p.resolvedCards.length > 0) {
              (game.state as any).zones[p.initiator].library = p.resolvedCards.map((c) => ({ ...c, zone: "library" }));
              (game.state as any).zones[p.initiator].libraryCount = p.resolvedCards.length;
            }
          }
        } catch (e) {
          console.warn("applyConfirmedImport: fallback library population failed", e);
        }
      }
      console.info(`[import] importDeckResolved called/attempted for player=${p.initiator} game=${p.gameId}`);
    } catch (err) {
      console.error("applyConfirmedImport: game.importDeckResolved failed", err);
    }

    // Ensure libraries set for UI if importDeckResolved didn't populate it
    try {
      const L = (game as any).libraries;
      if (L && typeof L.get === "function") {
        const arr = L.get(p.initiator) || [];
        if ((!arr || arr.length === 0) && p.resolvedCards && p.resolvedCards.length > 0) {
          try {
            L.set(p.initiator, p.resolvedCards.map((c: any) => ({ ...c, zone: "library" })));
            (game.state as any).zones = (game.state as any).zones || {};
            (game.state as any).zones[p.initiator] = (game.state as any).zones[p.initiator] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
            (game.state as any).zones[p.initiator].libraryCount = p.resolvedCards.length;
            console.info(`[import] libraries.set populated for player=${p.initiator} count=${p.resolvedCards.length}`);
          } catch (e) {
            console.warn("applyConfirmedImport: failed to set libraries map fallback", e);
          }
        }
      }
    } catch (e) {
      // ignore
    }

    // Defensive: ensure life & zones exist for player (avoid UI showing missing zones)
    try {
      const starting = (game.state && (game.state as any).startingLife) || 40;
      if ((game as any).life) (game as any).life[p.initiator] = starting;
      if ((game.state as any).life) (game.state as any).life[p.initiator] = starting;
      (game.state as any).zones = (game.state as any).zones || {};
      (game.state as any).zones[p.initiator] = (game.state as any).zones[p.initiator] || { hand: [], handCount: 0, libraryCount: ((game as any).libraries && typeof (game as any).libraries.get === "function" ? ((game as any).libraries.get(p.initiator) || []).length : 0), graveyard: [], graveyardCount: 0 };
      if ((game.state as any).zones[p.initiator].hand && Array.isArray((game.state as any).zones[p.initiator].hand)) {
        (game.state as any).zones[p.initiator].hand = [];
        (game.state as any).zones[p.initiator].handCount = 0;
      }
    } catch (e) {
      console.warn("applyConfirmedImport: defensive life/zones init failed", e);
    }

    // 3) Persist event for replay
    try {
      appendEvent(p.gameId, game.seq, "deckImportResolved", { playerId: p.initiator, cards: p.resolvedCards });
    } catch (err) {
      console.warn("applyConfirmedImport: appendEvent failed", err);
    }

    // 4) Flag pendingInitialDraw and suggest commanders to importer only
    try {
      // Flag pendingInitialDraw (state-layer may already do this in importDeckResolved)
      try {
        addPendingInitialDrawFlag(game, p.initiator);
        console.info(`[import] pendingInitialDraw flagged for player=${p.initiator} game=${p.gameId}`);
      } catch (e) {
        console.warn("applyConfirmedImport: pendingInitialDraw flagging failed", e);
      }

      // Suggest commanders to importer only (importerSocket preferred)
      const names = (() => {
        const cards = p.resolvedCards || [];
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
        const out: string[] = [];
        if (first?.name) out.push(first.name);
        if (second?.name && second.name !== first?.name) out.push(second.name);
        return out.slice(0, 2);
      })();

      try {
        if (importerSocket) {
          importerSocket.emit("suggestCommanders", { gameId: p.gameId, names });
        } else {
          // if no socket provided, best-effort: emit to the player room but clients should ignore if not intended
          io.to(p.gameId).emit("suggestCommanders", { gameId: p.gameId, names });
        }
        console.info(`[import] suggestCommanders sent to importer names=${JSON.stringify(names)}`);
      } catch (e) {
        console.warn("applyConfirmedImport: suggestCommanders emit failed", e);
      }

      // If commander already exists (authoritative), or the format isn't commander,
      // perform shuffle+opening draw now (idempotent: only if player's hand is empty).
      try {
        const cz = (game.state && game.state.commandZone && (game.state.commandZone as any)[p.initiator]) || null;
        const isCommanderFmt = String(game.state.format || "").toLowerCase() === "commander";
        const hasCommanderAlready = cz && Array.isArray(cz.commanderIds) && cz.commanderIds.length > 0;
        if (hasCommanderAlready || !isCommanderFmt) {
          // Use the existing pendingInitialDraw flag to safely perform shuffle+draw
          const pendingSet = (game as any).pendingInitialDraw as Set<PlayerID> | undefined;
          if (pendingSet && pendingSet.has(p.initiator)) {
            // check hand count to avoid double-draw
            const z = (game.state && (game.state as any).zones && (game.state as any).zones[p.initiator]) || null;
            const handCount = z ? (typeof z.handCount === "number" ? z.handCount : (Array.isArray(z.hand) ? z.hand.length : 0)) : 0;
            if (handCount === 0) {
              if (typeof (game as any).shuffleLibrary === "function") {
                try {
                  (game as any).shuffleLibrary(p.initiator);
                  appendEvent(p.gameId, game.seq, "shuffleLibrary", { playerId: p.initiator });
                } catch (e) {
                  console.warn("applyConfirmedImport: shuffleLibrary failed", e);
                }
              } else {
                console.warn("applyConfirmedImport: game.shuffleLibrary not available");
              }
              if (typeof (game as any).drawCards === "function") {
                try {
                  (game as any).drawCards(p.initiator, 7);
                  appendEvent(p.gameId, game.seq, "drawCards", { playerId: p.initiator, count: 7 });
                } catch (e) {
                  console.warn("applyConfirmedImport: drawCards failed", e);
                }
              } else {
                console.warn("applyConfirmedImport: game.drawCards not available");
              }
            }
            try { pendingSet.delete(p.initiator); } catch (e) { /* ignore */ }
          }
        }
      } catch (e) {
        console.warn("applyConfirmedImport: attempted immediate shuffle/draw failed", e);
      }

      // Broadcast authoritative state now (clients will request imported candidates and TableLayout will open gallery)
      try {
        broadcastGame(io, game, p.gameId);
      } catch (e) {
        console.warn("applyConfirmedImport: broadcastGame failed", e);
      }
    } catch (err) {
      console.warn("applyConfirmedImport: opening draw flow failed", err);
    }

    // 5) Optional persistence of deck if requested (save === true)
    if (p.save === true && p.deckName && p.deckName.trim()) {
      try {
        const deckId = `deck_${Date.now()}`;
        const created_by_name = (game.state.players as any[])?.find((pl) => pl.id === p.initiator)?.name || String(p.initiator);
        const card_count = p.parsedCount;
        saveDeckDB({
          id: deckId,
          name: p.deckName.trim(),
          text: "",
          created_by_id: p.initiator,
          created_by_name,
          card_count,
        });
        io.to(p.gameId).emit("savedDecksList", { gameId: p.gameId, decks: listDecks() });
      } catch (e) {
        console.warn("applyConfirmedImport: auto-save failed", e);
      }
    }

    // 6) Notify room and cleanup
    try {
      io.to(p.gameId).emit("importWipeConfirmed", { confirmId, gameId: p.gameId, by: p.initiator, deckName: p.deckName });
      try { broadcastGame(io, game, p.gameId); } catch {}
    } catch (err) {
      console.warn("applyConfirmedImport: final broadcast/notify failed", err);
    }

    // record last-applied stamp for dedupe
    try {
      (game as any)._lastImportAppliedBy = p.initiator;
      (game as any)._lastImportAppliedAt = Date.now();
    } catch (e) { /* ignore */ }
  } finally {
    try { const game = ensureGame(p.gameId); if (game) (game as any)._importApplying = false; } catch {}
    pendingImportConfirmations.delete(confirmId);
    console.info(`[import] applyConfirmedImport complete game=${p.gameId} initiator=${p.initiator}`);
  }
}

/* --- Main registration: socket handlers for deck management --- */
export function registerDeckHandlers(io: Server, socket: Socket) {
  socket.on(
    "importDeck",
    async ({ gameId, list, deckName, save }: { gameId: string; list: string; deckName?: string; save?: boolean }) => {
      const pid = socket.data.playerId as PlayerID | undefined;
      const spectator = socket.data.spectator;
      if (!pid || spectator) {
        socket.emit("deckError", { gameId, message: "Spectators cannot import decks." });
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
          socket.emit("deckError", { gameId, message: "Deck list appears empty or invalid." });
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

      const resolvedCards: Array<Pick<KnownCardRef, "id" | "name" | "type_line" | "oracle_text" | "image_uris">> = [];
      const missing: string[] = [];

      if (byName) {
        for (const { name, count } of parsed) {
          const key = name.trim().toLowerCase();
          const c = byName.get(key);
          if (!c) {
            missing.push(name);
            continue;
          }
          for (let i = 0; i < (count || 1); i++) {
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

      // Persist per-game import buffer (for commander UI)
      try {
        (game as any)._lastImportedDecks = (game as any)._lastImportedDecks || new Map<PlayerID, any[]>();
        (game as any)._lastImportedDecks.set(
          pid,
          resolvedCards.map((c) => ({ id: c.id, name: c.name, type_line: c.type_line, oracle_text: c.oracle_text, image_uris: c.image_uris }))
        );
      } catch (e) {
        console.warn("Could not set _lastImportedDecks on game object for importDeck:", e);
      }

      // If we failed to resolve any names, inform initiator and the room
      if (missing.length) {
        try {
          socket.emit("deckImportMissing", { gameId, missing });
          // broadcast a system chat message to the room
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `Missing (strict fetch): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", …" : ""}`,
            ts: Date.now(),
          });
        } catch (e) {
          console.warn("emit deckImportMissing failed", e);
        }
      }

      // Prepare confirmation request requiring unanimous consent from active players
      const players = (game.state.players || []).map((p: any) => p.id).filter(Boolean) as string[];
      const confirmId = `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const responses: Record<string, "pending" | "yes" | "no"> = {};
      for (const pl of players) responses[pl] = "pending";
      responses[pid] = "yes"; // initiator auto-yes

      const pending: PendingConfirm = {
        gameId,
        initiator: pid,
        resolvedCards,
        parsedCount: parsed.reduce((s, p) => s + (p.count || 0), 0),
        deckName,
        save,
        responses,
        timeout: null,
      };

      const TIMEOUT_MS = 60_000;
      pending.timeout = setTimeout(() => {
        cancelConfirmation(io, confirmId, "timeout");
      }, TIMEOUT_MS);

      // Store pending so applyConfirmedImport can find it
      pendingImportConfirmations.set(confirmId, pending);

      // NEW: unload transient zones for the importer immediately so UI doesn't show stale hand/commanders
      try {
        clearPlayerTransientZonesForImport(game, pid);
        try { broadcastGame(io, game, gameId); } catch (e) { /* best-effort */ }
      } catch (e) {
        console.warn("importDeck: clearing transient zones failed", e);
      }

      // NEW: ensure pendingInitialDraw is set now so setCommander later will trigger shuffle+draw
      try {
        addPendingInitialDrawFlag(game, pid);
        console.info(`[import] pendingInitialDraw (init) flagged for player=${pid} game=${gameId}`);
        try { broadcastGame(io, game, gameId); } catch (e) { /* best-effort */ }
      } catch (e) {
        console.warn("importDeck: addPendingInitialDrawFlag failed", e);
      }

      // Determine if we should auto-apply (solo OR pre-game / beginning)
      const phaseStr = String(game.state?.phase || "").toUpperCase();
      const pregame = phaseStr === "PRE_GAME" || phaseStr === "BEGINNING";
      if (players.length <= 1 || pregame) {
        // Immediate apply flow for importer-only: send suggestCommanders to importer then apply
        try {
          const names = (() => {
            const cards = resolvedCards || [];
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
            const out: string[] = [];
            if (first?.name) out.push(first.name);
            if (second?.name && second.name !== first?.name) out.push(second.name);
            return out.slice(0, 2);
          })();

          // send suggestion to importer only
          try { socket.emit("suggestCommanders", { gameId, names }); } catch (e) { /* ignore */ }

          // small delay to allow client to receive suggestCommanders before state broadcast
          setTimeout(() => {
            applyConfirmedImport(io, confirmId, socket).catch((err) => {
              console.error("immediate applyConfirmedImport failed:", err);
              cancelConfirmation(io, confirmId, "apply_failed");
            });
          }, 50);
        } catch (e) {
          console.warn("Immediate apply flow failed, falling back to confirm flow", e);
        }
        return;
      }

      // Otherwise, normal confirm flow: emit request and update
      try {
        io.to(gameId).emit("importWipeConfirmRequest", {
          confirmId,
          gameId,
          initiator: pid,
          deckName,
          resolvedCount: resolvedCards.length,
          expectedCount: pending.parsedCount,
          players,
          timeoutMs: TIMEOUT_MS,
        });
      } catch (err) {
        console.warn("importDeck: emit importWipeConfirmRequest failed", err);
      }

      broadcastConfirmUpdate(io, confirmId, pending);
    }
  );

  // Confirm response handler
  socket.on("confirmImportResponse", ({ gameId, confirmId, accept }: { gameId: string; confirmId: string; accept: boolean }) => {
    try {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid) return;
      const pending = pendingImportConfirmations.get(confirmId);
      if (!pending) {
        socket.emit("error", { code: "CONFIRM_NOT_FOUND", message: "Confirmation not found or expired" });
        return;
      }
      if (pending.gameId !== gameId) {
        socket.emit("error", { code: "CONFIRM_MISMATCH", message: "GameId mismatch" });
        return;
      }
      if (!(pid in pending.responses)) {
        socket.emit("error", { code: "CONFIRM_NOT_A_PLAYER", message: "You are not part of this confirmation" });
        return;
      }

      pending.responses[pid] = accept ? "yes" : "no";
      broadcastConfirmUpdate(io, confirmId, pending);

      const anyNo = Object.values(pending.responses).some((v) => v === "no");
      if (anyNo) {
        cancelConfirmation(io, confirmId, "voted_no");
        return;
      }

      const allYes = Object.values(pending.responses).every((v) => v === "yes");
      if (allYes) {
        applyConfirmedImport(io, confirmId).catch((err) => {
          console.error("applyConfirmedImport failed:", err);
          cancelConfirmation(io, confirmId, "apply_failed");
        });
      }
    } catch (err) {
      console.error("confirmImportResponse handler failed:", err);
    }
  });

  // getImportedDeckCandidates (private)
  socket.on("getImportedDeckCandidates", ({ gameId }: { gameId: string }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    const spectator = socket.data.spectator;
    if (!pid || spectator) {
      socket.emit("importedDeckCandidates", { gameId, candidates: [] });
      return;
    }
    try {
      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("importedDeckCandidates", { gameId, candidates: [] });
        return;
      }
      const buf = (game as any)._lastImportedDecks as Map<PlayerID, any[]> | undefined;
      const local = buf ? (buf.get(pid) || []) : [];
      const candidates = (local || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        type_line: c.type_line,
        oracle_text: c.oracle_text,
        image_uris: c.image_uris,
      }));
      socket.emit("importedDeckCandidates", { gameId, candidates });
    } catch (err) {
      console.warn("getImportedDeckCandidates failed:", err);
      socket.emit("importedDeckCandidates", { gameId, candidates: [] });
    }
  });

  // Test helper: force-apply any pending import where the socket player is the initiator.
  // Usage from browser console: socket.emit('applyPendingImport', { gameId: '<GAME_ID>' });
  socket.on('applyPendingImport', async ({ gameId }: { gameId: string }) => {
    try {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid) {
        socket.emit('error', { code: 'NOT_AUTH', message: 'Not authenticated' });
        return;
      }
      // find a pending confirm for this game and player
      let foundId: string | null = null;
      for (const [cid, p] of pendingImportConfirmations.entries()) {
        if (p.gameId === gameId && p.initiator === pid) {
          foundId = cid;
          break;
        }
      }
      if (!foundId) {
        socket.emit('error', { code: 'NO_PENDING_IMPORT', message: 'No pending import found for you in this game' });
        return;
      }
      // Call the applyConfirmedImport function from this module
      try {
        await applyConfirmedImport(io, foundId, socket);
        socket.emit('applyPendingImportResult', { gameId, success: true, confirmId: foundId });
      } catch (err) {
        console.error('applyPendingImport: applyConfirmedImport failed', err);
        socket.emit('applyPendingImportResult', { gameId, success: false, error: String(err) });
      }
    } catch (err) {
      console.error('applyPendingImport handler error', err);
      socket.emit('error', { code: 'APPLY_PENDING_IMPORT_ERROR', message: String(err) });
    }
  });

  // useSavedDeck: same resolution as importDeck but from saved DB
  socket.on("useSavedDeck", async ({ gameId, deckId }: { gameId: string; deckId: string }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    const spectator = socket.data.spectator;
    if (!pid || spectator) {
      socket.emit("deckError", { gameId, message: "Spectators cannot use saved decks." });
      return;
    }
    const game = ensureGame(gameId);
    const deck = getDeckDB(deckId);
    if (!deck) {
      socket.emit("deckError", { gameId, message: "Deck not found." });
      return;
    }
    try {
      const parsed = parseDecklist(deck.text);
      const requested = parsed.map((p) => p.name);
      let byName: Map<string, any> | null = null;
      try {
        byName = await fetchCardsByExactNamesBatch(requested);
      } catch {
        byName = null;
      }
      const resolved: Array<Pick<KnownCardRef, "id" | "name" | "type_line" | "oracle_text" | "image_uris">> = [];
      const missing: string[] = [];
      if (byName) {
        for (const { name, count } of parsed) {
          const key = name.trim().toLowerCase();
          const c = byName.get(key);
          if (!c) {
            missing.push(name);
            continue;
          }
          for (let i = 0; i < count; i++) {
            resolved.push({
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
            for (let i = 0; i < count; i++) {
              resolved.push({
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

      try {
        (game as any)._lastImportedDecks = (game as any)._lastImportedDecks || new Map<PlayerID, any[]>();
        (game as any)._lastImportedDecks.set(pid, resolved.map(c => ({ id: c.id, name: c.name, type_line: c.type_line, oracle_text: c.oracle_text, image_uris: c.image_uris })));
      } catch (e) {
        console.warn("Could not set _lastImportedDecks on game object for useSavedDeck:", e);
      }

      if (missing.length) {
        try {
          socket.emit("deckImportMissing", { gameId, missing });
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `Missing (strict fetch): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", …" : ""}`,
            ts: Date.now(),
          });
        } catch (e) {
          console.warn("useSavedDeck: emit deckImportMissing failed", e);
        }
      }

      const players = (game.state.players || []).map((p: any) => p.id).filter(Boolean) as string[];
      const confirmId = `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const responses: Record<string, "pending" | "yes" | "no"> = {};
      for (const pl of players) responses[pl] = "pending";
      responses[pid] = "yes";

      const pendingObj: PendingConfirm = {
        gameId,
        initiator: pid,
        resolvedCards: resolved,
        parsedCount: parsed.reduce((s, p) => s + (p.count || 0), 0),
        deckName: deck.name,
        save: false,
        responses,
        timeout: null,
      };

      pendingObj.timeout = setTimeout(() => {
        cancelConfirmation(io, confirmId, "timeout");
      }, 60_000);

      pendingImportConfirmations.set(confirmId, pendingObj);

      // NEW: unload transient zones for the importer immediately so UI doesn't show stale hand/commanders
      try {
        clearPlayerTransientZonesForImport(game, pid);
        try { broadcastGame(io, game, gameId); } catch (e) { /* best-effort */ }
      } catch (e) {
        console.warn("useSavedDeck: clearing transient zones failed", e);
      }

      // NEW: ensure pendingInitialDraw is set now so setCommander later will trigger shuffle+draw
      try {
        addPendingInitialDrawFlag(game, pid);
        console.info(`[useSavedDeck] pendingInitialDraw (init) flagged for player=${pid} game=${gameId}`);
        try { broadcastGame(io, game, gameId); } catch (e) { /* best-effort */ }
      } catch (e) {
        console.warn("useSavedDeck: addPendingInitialDrawFlag failed", e);
      }

      // Determine if we should auto-apply (solo OR pre-game / beginning)
      const phaseStr = String(game.state?.phase || "").toUpperCase();
      const pregame = phaseStr === "PRE_GAME" || phaseStr === "BEGINNING";
      if (players.length <= 1 || pregame) {
        try {
          const names = (() => {
            const cards = resolved || [];
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
            const out: string[] = [];
            if (first?.name) out.push(first.name);
            if (second?.name && second.name !== first?.name) out.push(second.name);
            return out.slice(0, 2);
          })();

          socket.emit("suggestCommanders", { gameId, names });

          setTimeout(() => {
            applyConfirmedImport(io, confirmId, socket).catch((err) => {
              console.error("immediate applyConfirmedImport (useSavedDeck) failed:", err);
              cancelConfirmation(io, confirmId, "apply_failed");
            });
          }, 50);
        } catch (e) {
          console.warn("useSavedDeck immediate apply failed, falling back to confirm flow", e);
        }
      } else {
        io.to(gameId).emit("importWipeConfirmRequest", {
          confirmId,
          gameId,
          initiator: pid,
          deckName: deck.name,
          resolvedCount: resolved.length,
          expectedCount: pendingObj.parsedCount,
          players,
          timeoutMs: 60_000,
        });

        broadcastConfirmUpdate(io, confirmId, pendingObj);
      }

      socket.emit("deckApplied", { gameId, deck });
    } catch (e) {
      socket.emit("deckError", { gameId, message: "Use deck failed." });
    }
  });

  // saveDeck, listSavedDecks, getSavedDeck, renameSavedDeck, deleteSavedDeck handlers (unchanged)
  socket.on("saveDeck", ({ gameId, name: dname, list }: { gameId: string; name: string; list: string }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    const spectator = socket.data.spectator;
    if (!pid || spectator) {
      socket.emit("deckError", { gameId, message: "Spectators cannot save decks." });
      return;
    }
    if (!dname || !dname.trim()) {
      socket.emit("deckError", { gameId, message: "Deck name required." });
      return;
    }
    if (!list || !list.trim()) {
      socket.emit("deckError", { gameId, message: "Deck list empty." });
      return;
    }
    if (list.length > 400_000) {
      socket.emit("deckError", { gameId, message: "Deck text too large." });
      return;
    }
    try {
      const deckId = `deck_${Date.now()}`;
      const game = ensureGame(gameId);
      const created_by_name =
        (game.state.players as any[])?.find((p) => p.id === pid)?.name || String(pid);
      const parsed = parseDecklist(list);
      const card_count = parsed.reduce((a, p) => a + (p.count || 0), 0);
      saveDeckDB({
        id: deckId,
        name: dname.trim(),
        text: list,
        created_by_id: pid,
        created_by_name,
        card_count,
      });
      const d = getDeckDB(deckId);
      if (d) {
        socket.emit("deckSaved", { gameId, deck: d });
        io.to(gameId).emit("savedDecksList", { gameId, decks: listDecks() });
      }
    } catch {
      socket.emit("deckError", { gameId, message: "Save failed." });
    }
  });

  socket.on("listSavedDecks", ({ gameId }: { gameId: string }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    const spectator = socket.data.spectator;
    if (!pid || spectator) return;
    try {
      const decks = listDecks();
      socket.emit("savedDecksList", { gameId, decks });
    } catch {
      socket.emit("deckError", { gameId, message: "Could not retrieve decks." });
    }
  });

  socket.on("getSavedDeck", ({ gameId, deckId }: { gameId: string; deckId: string }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    const spectator = socket.data.spectator;
    if (!pid || spectator) return;
    try {
      const deck = getDeckDB(deckId);
      if (!deck) {
        socket.emit("deckError", { gameId, message: "Deck not found." });
        return;
      }
      socket.emit("savedDeckDetail", { gameId, deck });
    } catch {
      socket.emit("deckError", { gameId, message: "Could not fetch deck details." });
    }
  });

  socket.on("renameSavedDeck", ({ gameId, deckId, name: newName }: { gameId: string; deckId: string; name: string }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    const spectator = socket.data.spectator;
    if (!pid || spectator) return;
    if (!newName || !newName.trim()) {
      socket.emit("deckError", { gameId, message: "Name required." });
      return;
    }
    const updated = renameDeck(deckId, newName.trim());
    if (!updated) {
      socket.emit("deckError", { gameId, message: "Rename failed or deck not found." });
      return;
    }
    socket.emit("deckRenamed", { gameId, deck: updated });
    io.to(gameId).emit("savedDecksList", { gameId, decks: listDecks() });
  });

  socket.on("deleteSavedDeck", ({ gameId, deckId }: { gameId: string; deckId: string }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    const spectator = socket.data.spectator;
    if (!pid || spectator) return;
    const deck = getDeckDB(deckId);
    if (!deck) {
      socket.emit("deckError", { gameId, message: "Deck not found." });
      return;
    }
    const game = ensureGame(gameId);
    const currentName = (game.state.players as any[])?.find((p) => p.id === pid)?.name || "";
    const allowed =
      deck.created_by_id === pid ||
      (deck.created_by_name || "").trim().toLowerCase() === currentName.trim().toLowerCase();
    if (!allowed) {
      socket.emit("deckError", { gameId, message: "Not authorized to delete deck." });
      return;
    }
    const deleted = deleteDeck(deckId);
    if (!deleted) {
      socket.emit("deckError", { gameId, message: "Deck deletion failed." });
      return;
    }
    socket.emit("deckDeleted", { gameId, deckId });
    io.to(gameId).emit("savedDecksList", { gameId, decks: listDecks() });
  });
}