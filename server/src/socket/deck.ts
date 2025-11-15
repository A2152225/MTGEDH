// server/src/socket/deck.ts
// Deck socket handlers: importDeck / useSavedDeck + confirmation flow
// Changes:
// - If solo OR game phase is PRE_GAME/BEGINNING, skip the vote and apply import immediately for the importer only.
// - Emit suggestCommanders to the importer socket only in immediate flow.
// - Keep idempotent guards to avoid repeated applies on reconnects.
// - Ensure libraries and zones reflect resolved cards so clients see correct libraryCount and that hand is cleared.

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

function cancelConfirmation(io: Server, confirmId: string, reason = "cancelled") {
  const p = pendingImportConfirmations.get(confirmId);
  if (!p) return;
  if (p.timeout) {
    try { clearTimeout(p.timeout); } catch {}
  }
  try {
    io.to(p.gameId).emit("importWipeCancelled", { confirmId, gameId: p.gameId, by: p.initiator, reason });
  } catch (e) {
    console.warn("cancelConfirmation emit failed", e);
  }
  pendingImportConfirmations.delete(confirmId);
}

/**
 * applyConfirmedImport - idempotent / reentrancy-safe application of confirmed import.
 *
 * Guards:
 *  - If game._importApplying === true, skip concurrent invocation.
 *  - If game._lastImportAppliedBy === initiator && within REPEAT_WINDOW_MS, skip repeat apply.
 *
 * After applying, broadcasts authoritative state and emits importWipeConfirmed to room.
 */
async function applyConfirmedImport(io: Server, confirmId: string) {
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

    // 2) Import into authoritative game state
    try {
      if (typeof (game as any).importDeckResolved === "function") {
        // call authoritative import
        (game as any).importDeckResolved(p.initiator, p.resolvedCards);
      } else {
        // best-effort: if game has libraries map
        try {
          const L = (game as any).libraries;
          if (L && typeof L.set === "function") {
            L.set(p.initiator, p.resolvedCards.map((c) => ({ ...c, zone: "library" })));
          } else if ((game.state as any).zones) {
            // fallback: populate state.zones
            (game.state as any).zones = (game.state as any).zones || {};
            (game.state as any).zones[p.initiator] = (game.state as any).zones[p.initiator] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
            (game.state as any).zones[p.initiator].libraryCount = p.resolvedCards.length;
          }
        } catch {}
      }
      console.info(`[import] importDeckResolved called for player=${p.initiator} game=${p.gameId}`);
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
            // ensure zones libraryCount reflects
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

    // Defensive: ensure life & zones exist for player (avoid UI showing 0s or missing zones)
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

    // 4) Opening-draw / (previously broadcast) commander suggestion handling
    try {
      const libCount = (() => {
        try {
          const z = (game.state.zones || {})[p.initiator];
          if (z && typeof z.libraryCount === "number") return z.libraryCount;
          const L = (game as any).libraries;
          if (L && typeof L.get === "function") {
            const arr = L.get(p.initiator) || [];
            return Array.isArray(arr) ? arr.length : 0;
          }
          if (L && Array.isArray(L[p.initiator])) return L[p.initiator].length;
          return 0;
        } catch (e) { return 0; }
      })();

      const handCountBefore = game.state.zones?.[p.initiator]?.handCount ?? 0;
      const isCommanderFmt = String(game.state.format).toLowerCase() === "commander";
      console.info(`[import] pre-opening state game=${p.gameId} player=${p.initiator} libCount=${libCount} handCount=${handCountBefore} commanderFmt=${isCommanderFmt}`);

      // Flag pendingInitialDraw (state-layer may already do this in importDeckResolved)
      try {
        if ((game as any).pendingInitialDraw && typeof (game as any).pendingInitialDraw.add === "function") {
          (game as any).pendingInitialDraw.add(p.initiator);
          console.info(`[import] pendingInitialDraw flagged for player=${p.initiator} game=${p.gameId}`);
        } else {
          (game as any).pendingInitialDraw = (game as any).pendingInitialDraw || new Set<PlayerID>();
          (game as any).pendingInitialDraw.add(p.initiator);
          console.info(`[import] pendingInitialDraw (fallback) flagged for player=${p.initiator} game=${p.gameId}`);
        }
      } catch (e) {
        console.warn("applyConfirmedImport: pendingInitialDraw flagging failed", e);
      }

      // NOTE: Suggestion emission to clients is handled by the caller in immediate/no-vote flows
      // For safety, still attempt to broadcast to room (best-effort), but do not rely on it exclusively.
      try {
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

        // Best-effort broadcast (clients will also call getImportedDeckCandidates)
        try { io.to(p.gameId).emit("suggestCommanders", { gameId: p.gameId, names }); } catch (e) {}
        console.info(`[import] suggestCommanders broadcast names=${JSON.stringify(names)}`);
      } catch (e) {
        console.warn("applyConfirmedImport: suggestCommanders broadcast failed", e);
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

/* --- Helper: suggest commanders heuristics (unchanged) --- */
function suggestCommanderNames(
  cards: Array<Pick<KnownCardRef, "name" | "type_line" | "oracle_text">>
) {
  const isLegendary = (tl?: string) =>
    (tl || "").toLowerCase().includes("legendary");
  const isEligibleType = (tl?: string) => {
    const t = (tl || "").toLowerCase();
    return (
      t.includes("creature") ||
      t.includes("planeswalker") ||
      t.includes("background")
    );
  };
  const hasPartnerish = (oracle?: string, tl?: string) => {
    const o = (oracle || "").toLowerCase();
    const t = (tl || "").toLowerCase();
    return o.includes("partner") || o.includes("background") || t.includes("background");
  };
  const pool = cards.filter(
    (c) => isLegendary(c.type_line) && isEligibleType(c.type_line)
  );
  const first = pool[0];
  const second = pool.slice(1).find((c) => hasPartnerish(c.oracle_text, c.type_line));
  const names: string[] = [];
  if (first?.name) names.push(first.name);
  if (second?.name && second.name !== first.name) names.push(second.name);
  return names.slice(0, 2);
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

      // Determine if we should auto-apply (solo OR pre-game / beginning)
      const phaseStr = String(game.state?.phase || "").toUpperCase();
      const pregame = phaseStr === "PRE_GAME" || phaseStr === "BEGINNING";
      if (players.length <= 1 || pregame) {
        // Immediate apply flow for importer-only
        try {
          // Emit suggestCommanders only to the importer (this socket)
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

          // apply immediately (no vote)
          setTimeout(() => {
            applyConfirmedImport(io, confirmId).catch((err) => {
              console.error("immediate applyConfirmedImport failed:", err);
              cancelConfirmation(io, confirmId, "apply_failed");
            });
          }, 50); // small delay to allow client to receive suggestCommanders before state broadcast
        } catch (e) {
          console.warn("Immediate apply flow failed, falling back to confirm flow", e);
          // fall through to normal confirm flow
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
            applyConfirmedImport(io, confirmId).catch((err) => {
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