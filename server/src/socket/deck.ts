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
 * - Single-player imports auto-apply for convenience, but we delay slightly to allow the client to
 *   register listeners (suggestCommanders etc.). After applying import we:
 *     - call game.importDeckResolved(...)
 *     - flag pendingInitialDraw for commander format players
 *     - broadcastGame to update all participants
 *     - emit suggestCommanders to the initiator socket if available
 *
 * Instrumentation/logging added to help diagnose missing pendingInitialDraw / library counts.
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

async function applyConfirmedImport(io: Server, confirmId: string) {
  const p = pendingImportConfirmations.get(confirmId);
  if (!p) return;
  if (p.timeout) {
    try { clearTimeout(p.timeout); } catch {}
  }

  try {
    const game = ensureGame(p.gameId);
    if (!game) {
      io.to(p.gameId).emit("importWipeCancelled", { confirmId, gameId: p.gameId, by: p.initiator, reason: "game_not_found" });
      pendingImportConfirmations.delete(confirmId);
      return;
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
      game.importDeckResolved(p.initiator, p.resolvedCards);
      console.info(`[import] importDeckResolved called for player=${p.initiator} game=${p.gameId}`);
    } catch (err) {
      console.error("applyConfirmedImport: game.importDeckResolved failed", err);
    }

    // 3) Persist event for replay
    try {
      appendEvent(p.gameId, game.seq, "deckImportResolved", { playerId: p.initiator, cards: p.resolvedCards });
    } catch (err) {
      console.warn("applyConfirmedImport: appendEvent failed", err);
    }

    // 4) Opening-draw / commander suggestion handling
    try {
      // Recompute library count (best-effort) to log
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

      if (handCountBefore === 0) {
        if (isCommanderFmt) {
          // flag pending opening draw so setCommander can complete draw after selection
          try {
            if (typeof (game as any).flagPendingOpeningDraw === "function") {
              (game as any).flagPendingOpeningDraw(p.initiator);
            } else {
              (game as any).pendingInitialDraw = (game as any).pendingInitialDraw || new Set<PlayerID>();
              (game as any).pendingInitialDraw.add(p.initiator);
            }
            console.info(`[import] pendingInitialDraw flagged for player=${p.initiator} game=${p.gameId}`);
          } catch (e) {
            console.warn("applyConfirmedImport: flagPendingOpeningDraw failed", e);
          }

          // Broadcast authoritative state now (so client sees imported library/zones)
          try {
            broadcastGame(io, game, p.gameId);
          } catch (e) {
            console.warn("applyConfirmedImport: broadcastGame failed", e);
          }

          // Suggest commander names to initiator (use participants to find socket id)
          try {
            const names = suggestCommanderNames(p.resolvedCards);
            const participants = typeof (game as any).participants === "function" ? (game as any).participants() : [];
            const initiatorSock = participants.find((pp: any) => pp.playerId === p.initiator)?.socketId;
            if (initiatorSock) {
              io.to(initiatorSock).emit("suggestCommanders", { gameId: p.gameId, names });
              console.info(`[import] suggestCommanders emitted to socket=${initiatorSock} names=${JSON.stringify(names)}`);
            } else {
              // fallback: emit to game room (clients will filter)
              io.to(p.gameId).emit("suggestCommanders", { gameId: p.gameId, names });
              console.info(`[import] suggestCommanders broadcast to room names=${JSON.stringify(names)}`);
            }
          } catch (e) {
            console.warn("applyConfirmedImport: suggestCommanders emit failed", e);
          }

          // Do NOT perform draw here — setCommander should remove commander from library and perform the pending opening draw.
        } else {
          // Non-commander: shuffle + draw immediately
          try {
            game.shuffleLibrary(p.initiator);
            appendEvent(p.gameId, game.seq, "shuffleLibrary", { playerId: p.initiator });
            game.drawCards(p.initiator, 7);
            appendEvent(p.gameId, game.seq, "drawCards", { playerId: p.initiator, count: 7 });
            console.info(`[import] non-commander opening draw done for player=${p.initiator}`);
          } catch (e) {
            console.warn("applyConfirmedImport: shuffle/draw failed", e);
          }
        }
      } else {
        // handCountBefore > 0 -- nothing to do for opening draw
        console.info(`[import] handCountBefore > 0; skipping opening draw for player=${p.initiator}`);
        // still broadcast to ensure clients see final state
        try { broadcastGame(io, game, p.gameId); } catch (e) { console.warn("broadcastGame failed", e); }
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
      io.to(p.gameId).emit("importWipeConfirmed", { confirmId, gameId: p.gameId, by: p.initiator });
      // broadcastGame may already have been called; safe to call again to ensure visibility
      try { broadcastGame(io, game, p.gameId); } catch {}
    } catch (err) {
      console.warn("applyConfirmedImport: final broadcast/notify failed", err);
    }
  } finally {
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
  // importDeck: parse, resolve via Scryfall (batch + fallback), keep per-game buffer,
  // then request unanimous confirmation to reset and apply import.
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

      // Persist per-game import buffer (for commander selection UI)
      try {
        (game as any)._lastImportedDecks = (game as any)._lastImportedDecks || new Map<PlayerID, any[]>();
        (game as any)._lastImportedDecks.set(
          pid,
          resolvedCards.map((c) => ({ id: c.id, name: c.name, type_line: c.type_line, oracle_text: c.oracle_text, image_uris: c.image_uris }))
        );
      } catch (e) {
        console.warn("Could not set _lastImportedDecks on game object for importDeck:", e);
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

      // Timeout: treat non-response as No (cancel)
      const TIMEOUT_MS = 60_000;
      pending.timeout = setTimeout(() => {
        cancelConfirmation(io, confirmId, "timeout");
      }, TIMEOUT_MS);

      pendingImportConfirmations.set(confirmId, pending);

      // Broadcast request to participants; client shows modal and per-player votes
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

      // Initial vote update
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

  // getImportedDeckCandidates: return last resolved imported cards for requesting player
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

  // useSavedDeck: import by id (creates a confirmation like importDeck)
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

      // Persist resolved into import buffer
      try {
        (game as any)._lastImportedDecks = (game as any)._lastImportedDecks || new Map<PlayerID, any[]>();
        (game as any)._lastImportedDecks.set(pid, resolved.map(c => ({
          id: c.id, name: c.name, type_line: c.type_line, oracle_text: c.oracle_text, image_uris: c.image_uris
        })));
      } catch (e) {
        console.warn("Could not set _lastImportedDecks on game object for useSavedDeck:", e);
      }

      // Create confirmation (same as importDeck)
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

      // Auto-apply for single-player saved-deck use (small delay)
      if (players.length <= 1) {
        setTimeout(() => {
          applyConfirmedImport(io, confirmId).catch((err) => {
            console.error("auto applyConfirmedImport for useSavedDeck failed:", err);
            cancelConfirmation(io, confirmId, "apply_failed");
          });
        }, 150);
      }

      socket.emit("deckApplied", { gameId, deck });
      if (missing.length) {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `Missing (strict fetch): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", …" : ""}`,
          ts: Date.now(),
        });
      }
    } catch (e) {
      socket.emit("deckError", { gameId, message: "Use deck failed." });
    }
  });

  // saveDeck: explicit save endpoint
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