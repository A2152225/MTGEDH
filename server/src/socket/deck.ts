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

    try { broadcastGame(io, game, p.gameId); } catch (e) { /* best-effort */ }
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

    // mark pre-game
    try { (game.state as any).phase = "PRE_GAME"; } catch (e) { /* ignore */ }
  } catch (e) {
    console.warn("clearPlayerTransientZonesForImport failed:", e);
  }
}

/* Helper: best-effort active player ids */
function getActivePlayerIds(game: any, io: Server, gameId: string): string[] {
  try {
    // Primary: game.state.players array (filter inactive)
    const sPlayers = (game && game.state && Array.isArray(game.state.players)) ? game.state.players : null;
    if (sPlayers) {
      const active = sPlayers.filter((p: any) => !p?.inactive).map((p: any) => p?.id).filter(Boolean);
      if (active.length > 0) return Array.from(new Set(active));
      const ids = sPlayers.map((p: any) => p?.id).filter(Boolean);
      if (ids.length > 0) return Array.from(new Set(ids));
    }

    // Fallback: game.participants() if available
    if (typeof (game as any).participants === "function") {
      try {
        const parts = (game as any).participants();
        const ids = Array.isArray(parts) ? parts.map((pp: any) => pp.playerId).filter(Boolean) : [];
        if (ids.length > 0) return Array.from(new Set(ids));
      } catch (e) { /* ignore */ }
    }

    // Last-resort: look at socket.io room members and map socketId -> playerId from participants list if available
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
  if (!p) return;
  if (p.timeout) {
    try { clearTimeout(p.timeout); } catch {}
  }

  const REPEAT_WINDOW_MS = 5_000;

  try {
    const game = ensureGame(p.gameId);
    if (!game) {
      try { io.to(p.gameId).emit("importWipeCancelled", { confirmId, gameId: p.gameId, by: p.initiator, reason: "game_not_found" }); } catch {}
      pendingImportConfirmations.delete(confirmId);
      return;
    }

    const importerOnly = !!p.applyImporterOnly;

    // guard concurrent applies
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

    console.info(`[import] applyConfirmedImport start game=${p.gameId} initiator=${p.initiator} cards=${p.resolvedCards.length} importerOnly=${importerOnly}`);

    // 1) Reset preserving players only for full-wipe flows
    if (!importerOnly) {
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
    } else {
      console.info(`[import] importer-only apply: skipping full reset for game=${p.gameId}`);
    }

    // 2) Import into authoritative game state (preferred hook)
    try {
      if (typeof (game as any).importDeckResolved === "function") {
        try {
          (game as any).importDeckResolved(p.initiator, p.resolvedCards);
        } catch {
          // If hook expects different signature/options, we still call legacy signature
          (game as any).importDeckResolved(p.initiator, p.resolvedCards);
        }
      }
      console.info(`[import] importDeckResolved called/attempted for player=${p.initiator} game=${p.gameId}`);
    } catch (err) {
      console.error("applyConfirmedImport: game.importDeckResolved failed", err);
    }

    // 2b) Ensure authoritative libraries/zones for initiator (overwrite)
    try {
      const mapped = (p.resolvedCards || []).map((c: any) => ({ ...c, zone: "library" }));
      const L = (game as any).libraries;
      if (L && typeof L.set === "function") {
        try {
          L.set(p.initiator, mapped);
          console.info(`[import] libraries.set overwritten for player=${p.initiator} count=${mapped.length}`);
        } catch (e) {
          console.warn("applyConfirmedImport: libraries.set overwrite failed", e);
        }
      } else {
        try {
          game.state = game.state || {};
          game.state.zones = game.state.zones || {};
          game.state.zones[p.initiator] = game.state.zones[p.initiator] || { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0 };
          game.state.zones[p.initiator].library = mapped;
          // Set libraryCount to declared parsedCount when available to avoid UI defaulting to 100
          game.state.zones[p.initiator].libraryCount = (typeof p.parsedCount === "number" ? p.parsedCount : mapped.length);
          console.info(`[import] state.zones library overwritten for player=${p.initiator} count=${game.state.zones[p.initiator].libraryCount}`);
        } catch (e) {
          console.warn("applyConfirmedImport: state.zones overwrite failed", e);
        }
      }
    } catch (e) {
      console.warn("applyConfirmedImport: forced library overwrite failed", e);
    }

    // Defensive ensure life & zones exist for player
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

    // 3) Persist event for replay (annotate importerOnly)
    try {
      appendEvent(p.gameId, game.seq, "deckImportResolved", { playerId: p.initiator, cards: p.resolvedCards, importerOnly });
    } catch (err) {
      console.warn("applyConfirmedImport: appendEvent failed", err);
    }

    // 4) Flag pendingInitialDraw and emit suggestions/candidates to importer so TableLayout can open gallery
    try {
      addPendingInitialDrawFlag(game, p.initiator);
      try { broadcastGame(io, game, p.gameId); } catch (e) { console.warn("applyConfirmedImport: broadcastGame failed", e); }

      // Build commander suggestion names
      const names = suggestCommanderNames(p.resolvedCards);

      // Prepare candidate payload
      const candidates = (p.resolvedCards || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        type_line: c.type_line,
        oracle_text: c.oracle_text,
        image_uris: c.image_uris,
      }));

      // If importerSocket provided (immediate importer-only flow), emit to importer directly.
      if (importerSocket) {
        try {
          importerSocket.emit("suggestCommanders", { gameId: p.gameId, names });
          importerSocket.emit("importedDeckCandidates", { gameId: p.gameId, candidates });
          importerSocket.emit("importApplied", { confirmId, gameId: p.gameId, by: p.initiator, deckName: p.deckName, importerOnly });
          console.info(`[import] sent suggestCommanders/importedDeckCandidates/importApplied to importer socket for player=${p.initiator}`);
        } catch (e) {
          console.warn("applyConfirmedImport: emit to importerSocket failed", e);
        }
      } else {
        // fallback emit suggestCommanders to room (clients filter). Do not broadcast importedDeckCandidates to room.
        try {
          io.to(p.gameId).emit("suggestCommanders", { gameId: p.gameId, names });
        } catch (e) {
          console.warn("applyConfirmedImport: suggestCommanders broadcast failed", e);
        }
      }

      // If commander already present or non-commander format, immediate shuffle+draw
      try {
        const cz = (game.state && game.state.commandZone && (game.state.commandZone as any)[p.initiator]) || null;
        const isCommanderFmt = String(game.state.format || "").toLowerCase() === "commander";
        const hasCommanderAlready = cz && Array.isArray(cz.commanderIds) && cz.commanderIds.length > 0;
        if (hasCommanderAlready || !isCommanderFmt) {
          const pendingSet = (game as any).pendingInitialDraw as Set<PlayerID> | undefined;
          if (pendingSet && pendingSet.has(p.initiator)) {
            const z = (game.state && (game.state as any).zones && (game.state as any).zones[p.initiator]) || null;
            const handCount = z ? (typeof z.handCount === "number" ? z.handCount : (Array.isArray(z.hand) ? z.hand.length : 0)) : 0;
            if (handCount === 0) {
              if (typeof (game as any).shuffleLibrary === "function") {
                try { (game as any).shuffleLibrary(p.initiator); appendEvent(p.gameId, game.seq, "shuffleLibrary", { playerId: p.initiator }); } catch (e) { console.warn("applyConfirmedImport: shuffleLibrary failed", e); }
              }
              if (typeof (game as any).drawCards === "function") {
                try { (game as any).drawCards(p.initiator, 7); appendEvent(p.gameId, game.seq, "drawCards", { playerId: p.initiator, count: 7 }); } catch (e) { console.warn("applyConfirmedImport: drawCards failed", e); }
              }
            }
            try { pendingSet.delete(p.initiator); } catch (e) { /* ignore */ }
          }
        }
      } catch (e) {
        console.warn("applyConfirmedImport: attempted immediate shuffle/draw failed", e);
      }

      try { broadcastGame(io, game, p.gameId); } catch (e) { console.warn("applyConfirmedImport: broadcastGame failed", e); }
    } catch (err) {
      console.warn("applyConfirmedImport: opening draw flow failed", err);
    }

    // 5) Optional auto-save
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
      if (!importerOnly) {
        try { io.to(p.gameId).emit("importWipeConfirmed", { confirmId, gameId: p.gameId, by: p.initiator }); } catch (e) { console.warn("applyConfirmedImport: importWipeConfirmed emit failed", e); }
      }
      try { broadcastGame(io, game, p.gameId); } catch {}
    } catch (err) {
      console.warn("applyConfirmedImport: final broadcast/notify failed", err);
    }

    // record last-applied stamp
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
  // importDeck
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

      // Persist per-game import buffer
      try {
        (game as any)._lastImportedDecks = (game as any)._lastImportedDecks || new Map<PlayerID, any[]>();
        (game as any)._lastImportedDecks.set(
          pid,
          resolvedCards.map((c) => ({ id: c.id, name: c.name, type_line: c.type_line, oracle_text: c.oracle_text, image_uris: c.image_uris }))
        );
      } catch (e) {
        console.warn("Could not set _lastImportedDecks on game object for importDeck:", e);
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
          console.warn("emit deckImportMissing failed", e);
        }
      }

      // Prepare confirmation request requiring unanimous consent from active players
      const activePlayerIds = getActivePlayerIds(game, io, gameId);
      const players = activePlayerIds.length > 0 ? activePlayerIds : (game.state.players || []).map((p:any)=>p.id).filter(Boolean) as string[];

      const confirmId = `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const responses: Record<string, "pending" | "yes" | "no"> = {};
      for (const pl of players) responses[pl] = "pending";
      responses[pid] = "yes"; // initiator auto-yes

      // capture snapshot of importer transient zones to allow restore on cancel
      const snapshotZones = (game.state && (game.state as any).zones && (game.state as any).zones[pid]) ? JSON.parse(JSON.stringify((game.state as any).zones[pid])) : null;
      const snapshotCommandZone = (game.state && (game.state as any).commandZone && (game.state as any).commandZone[pid]) ? JSON.parse(JSON.stringify((game.state as any).commandZone[pid])) : null;
      const snapshotPhase = (game.state && (game.state as any).phase !== undefined) ? (game.state as any).phase : null;

      const pending: PendingConfirm = {
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
      pending.timeout = setTimeout(() => {
        cancelConfirmation(io, confirmId, "timeout");
      }, TIMEOUT_MS);

      pendingImportConfirmations.set(confirmId, pending);

      // Clear transient zones for the importer so UI doesn't show stale hand/commanders
      try {
        clearPlayerTransientZonesForImport(game, pid);
        try { broadcastGame(io, game, gameId); } catch (e) { /* best-effort */ }
      } catch (e) {
        console.warn("importDeck: clearing transient zones failed", e);
      }

      // Ensure pendingInitialDraw is set now so setCommander later will trigger shuffle+draw
      try {
        addPendingInitialDrawFlag(game, pid);
        try { broadcastGame(io, game, gameId); } catch (e) { /* best-effort */ }
      } catch (e) {
        console.warn("importDeck: addPendingInitialDrawFlag failed", e);
      }

      // Decide importer-only: new games / pre-game / single active player
      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      const pregame = phaseStr === "" || phaseStr === "PRE_GAME" || phaseStr.includes("BEGIN");
      const seqIsZero = (typeof (game as any).seq === "number" && (game as any).seq === 0);
      const activeCount = players.length;

      console.info(`[import] decision inputs game=${gameId} seq=${(game as any).seq} seqIsZero=${seqIsZero} phase="${phaseStr}" activeCount=${activeCount} playersForConfirm=${players.length}`);

      if (seqIsZero || pregame || activeCount <= 1) {
        // importer-only apply
        pending.applyImporterOnly = true;
        pendingImportConfirmations.set(confirmId, pending);

        try {
          const names = suggestCommanderNames(resolvedCards);
          try { socket.emit("suggestCommanders", { gameId, names }); } catch (e) { /* ignore */ }
        } catch (e) { /* ignore */ }

        // small delay to ensure client listeners attach
        setTimeout(() => {
          applyConfirmedImport(io, confirmId, socket).catch((err) => {
            console.error("immediate applyConfirmedImport failed:", err);
            cancelConfirmation(io, confirmId, "apply_failed");
          });
        }, 50);
        return;
      }

      // Otherwise normal confirm flow
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

      // If only one active player, auto-apply after a short delay so client listeners can attach
      try {
        if (players.length <= 1) {
          setTimeout(() => {
            applyConfirmedImport(io, confirmId).catch((err) => {
              console.error("auto applyConfirmedImport failed:", err);
              cancelConfirmation(io, confirmId, "apply_failed");
            });
          }, 150); // small delay
        }
      } catch (e) {
        console.warn("importDeck: auto-apply single-player failed", e);
      }
    }
  );

  // Handle confirmation responses
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

  // getImportedDeckCandidates
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

  // useSavedDeck
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
          const key = normalizeName(name).toLowerCase();
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

      // Prepare confirmation (same as importDeck)
      const activePlayerIds = getActivePlayerIds(game, io, gameId);
      const players = activePlayerIds.length > 0 ? activePlayerIds : (game.state.players || []).map((p:any)=>p.id).filter(Boolean) as string[];

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
        snapshotZones: (game.state && (game.state as any).zones && (game.state as any).zones[pid]) ? JSON.parse(JSON.stringify((game.state as any).zones[pid])) : null,
        snapshotCommandZone: (game.state && (game.state as any).commandZone && (game.state as any).commandZone[pid]) ? JSON.parse(JSON.stringify((game.state as any).commandZone[pid])) : null,
        snapshotPhase: (game.state && (game.state as any).phase !== undefined) ? (game.state as any).phase : null,
        applyImporterOnly: false,
      };

      pendingObj.timeout = setTimeout(() => {
        cancelConfirmation(io, confirmId, "timeout");
      }, 60_000);

      pendingImportConfirmations.set(confirmId, pendingObj);

      // Clear transient zones & flag pendingInitialDraw
      try { clearPlayerTransientZonesForImport(game, pid); addPendingInitialDrawFlag(game, pid); try { broadcastGame(io, game, gameId); } catch {} } catch (e) { console.warn("useSavedDeck: transient init failed", e); }

      // PRE_GAME shortcut
      const phaseStr2 = String(game.state?.phase || "").toUpperCase().trim();
      const pregame2 = phaseStr2 === "" || phaseStr2 === "PRE_GAME" || phaseStr2.includes("BEGIN");
      const seqZero2 = (typeof (game as any).seq === "number" && (game as any).seq === 0);
      const activeCount2 = players.length || activePlayerIds.length || 0;
      console.info(`[useSavedDeck] decision game=${gameId} seq=${(game as any).seq} seqIsZero=${seqZero2} phase="${phaseStr2}" activeCount=${activeCount2}`);

      if (seqZero2 || pregame2 || activeCount2 <= 1) {
        pendingObj.applyImporterOnly = true;
        pendingImportConfirmations.set(confirmId, pendingObj);

        try {
          const names = suggestCommanderNames(resolved);
          try { socket.emit("suggestCommanders", { gameId, names }); } catch {}
        } catch (e) { /* ignore */ }

        setTimeout(() => {
          applyConfirmedImport(io, confirmId, socket).catch((err) => {
            console.error("immediate applyConfirmedImport (useSavedDeck) failed:", err);
            cancelConfirmation(io, confirmId, "apply_failed");
          });
        }, 50);

        socket.emit("deckApplied", { gameId, deck });
        return;
      }

      try {
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
      } catch (err) {
        console.warn("useSavedDeck: emit importWipeConfirmRequest failed", err);
      }

      broadcastConfirmUpdate(io, confirmId, pendingObj);

      // Auto-apply for single-player saved-deck use (small delay)
      try {
        if (players.length <= 1) {
          setTimeout(() => {
            applyConfirmedImport(io, confirmId).catch((err) => {
              console.error("auto applyConfirmedImport for useSavedDeck failed:", err);
              cancelConfirmation(io, confirmId, "apply_failed");
            });
          }, 150);
        }
      } catch (e) { /* best-effort */ }

      socket.emit("deckApplied", { gameId, deck });
    } catch (e) {
      socket.emit("deckError", { gameId, message: "Use deck failed." });
    }
  });

  // save/list/get/rename/delete handlers (unchanged)
  socket.on("saveDeck", ({ gameId, name, list }: { gameId: string; name: string; list: string }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    const spectator = socket.data.spectator;
    if (!pid || spectator) {
      socket.emit("deckError", { gameId, message: "Spectators cannot save decks." });
      return;
    }
    if (!name || !name.trim()) {
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
        name: name.trim(),
        text: list,
        created_by_id: pid,
        created_by_name,
        card_count,
      });
      const d = getDeckDB(deckId);
      if (d) {
        const { text: _omit, entries: _omit2, ...summary } = d as any;
        socket.emit("deckSaved", { gameId, deck: summary });
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

  socket.on("renameSavedDeck", ({ gameId, deckId, name }: { gameId: string; deckId: string; name: string }) => {
    const pid = socket.data.playerId as PlayerID | undefined;
    const spectator = socket.data.spectator;
    if (!pid || spectator) return;
    if (!name || !name.trim()) {
      socket.emit("deckError", { gameId, message: "Name required." });
      return;
    }
    const updated = renameDeckDB(deckId, name.trim());
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
    const deleted = deleteDeckDB(deckId);
    if (!deleted) {
      socket.emit("deckError", { gameId, message: "Deck deletion failed." });
      return;
    }
    socket.emit("deckDeleted", { gameId, deckId });
    io.to(gameId).emit("savedDecksList", { gameId, decks: listDecks() });
  });
}