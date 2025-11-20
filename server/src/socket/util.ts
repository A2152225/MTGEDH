// server/src/socket/util.ts
// Socket helper utilities used by server socket handlers.
// Provides: ensureGame (create/replay), broadcastGame, appendGameEvent,
// priority timer scheduling (schedulePriorityTimeout + doAutoPass),
// clearPriorityTimer, and a parseManaCost helper.
//
// This is a full-file authoritative implementation (no truncation).
//
// NOTE: Small, safe additions: normalizeViewForEmit + ensureStateZonesForPlayers
// and env-gated verbose logging when DEBUG_STATE=1.

import type { Server } from "socket.io";
import { games, priorityTimers, PRIORITY_TIMEOUT_MS } from "./socket";
import { appendEvent, createGameIfNotExists, getEvents } from "../db";
import { createInitialGameState } from "../state";
import type { InMemoryGame } from "../state/types";
import { GameManager } from "../GameManager";

/* ------------------- Defensive normalization helpers ------------------- */

/** canonical minimal zone shape for a player */
function defaultPlayerZones() {
  return { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0 };
}

/**
 * Ensure authoritative in-memory game.state.zones has entries for all players.
 */
function ensureStateZonesForPlayers(game: any) {
  try {
    if (!game) return;
    game.state = game.state || {};
    game.state.players = game.state.players || [];
    game.state.zones = game.state.zones || {};
    for (const p of game.state.players) {
      const pid = p?.id ?? p?.playerId;
      if (!pid) continue;
      if (!game.state.zones[pid]) game.state.zones[pid] = defaultPlayerZones();
      else {
        const z = game.state.zones[pid];
        z.hand = Array.isArray(z.hand) ? z.hand : [];
        z.handCount = typeof z.handCount === "number" ? z.handCount : (Array.isArray(z.hand) ? z.hand.length : 0);
        z.library = Array.isArray(z.library) ? z.library : [];
        z.libraryCount = typeof z.libraryCount === "number" ? z.libraryCount : (Array.isArray(z.library) ? z.library.length : 0);
        z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
        z.graveyardCount = typeof z.graveyardCount === "number" ? z.graveyardCount : (Array.isArray(z.graveyard) ? z.graveyard.length : 0);
      }
    }
  } catch (e) {
    console.warn("ensureStateZonesForPlayers failed:", e);
  }
}

function normalizeViewForEmit(rawView: any, game: any) {
  try {
    const view = rawView || {};
    view.zones = view.zones || {};
    const players =
      Array.isArray(view.players)
        ? view.players
        : (game && game.state && Array.isArray(game.state.players) ? game.state.players : []);
    for (const p of players) {
      const pid = p?.id ?? p?.playerId;
      if (!pid) continue;
      view.zones[pid] = view.zones[pid] ?? defaultPlayerZones();
    }

    // Mirror minimal shape back into authoritative game.state.zones to avoid other server modules observing undefined.
    try {
      if (game && game.state) {
        game.state.zones = game.state.zones || {};
        for (const pid of Object.keys(view.zones)) {
          if (!game.state.zones[pid]) game.state.zones[pid] = view.zones[pid];
          else {
            const src = view.zones[pid];
            const dst = game.state.zones[pid];
            dst.hand = Array.isArray(dst.hand) ? dst.hand : (Array.isArray(src.hand) ? src.hand : []);
            dst.handCount = typeof dst.handCount === "number" ? dst.handCount : (Array.isArray(dst.hand) ? dst.hand.length : 0);
            dst.library = Array.isArray(dst.library) ? dst.library : (Array.isArray(src.library) ? src.library : []);
            dst.libraryCount = typeof dst.libraryCount === "number" ? dst.libraryCount : (Array.isArray(dst.library) ? dst.library.length : 0);
            dst.graveyard = Array.isArray(dst.graveyard) ? dst.graveyard : (Array.isArray(src.graveyard) ? src.graveyard : []);
            dst.graveyardCount = typeof dst.graveyardCount === "number" ? dst.graveyardCount : (Array.isArray(dst.graveyard) ? dst.graveyard.length : 0);
          }
        }
      }
    } catch {
      // non-fatal
    }

    return view;
  } catch (e) {
    console.warn("normalizeViewForEmit failed:", e);
    return rawView || {};
  }
}

/* --- Debug logging helper (env-gated) --- */
function logStateDebug(prefix: string, gameId: string, view: any) {
  try {
    const enabled = process.env.DEBUG_STATE === "1";
    if (!enabled) return;
    const playerIds = (Array.isArray(view?.players) ? view.players.map((p: any) => p?.id ?? p?.playerId) : []);
    const zoneKeys = view?.zones ? Object.keys(view.zones) : [];
    console.log(`[STATE_DEBUG] ${prefix} gameId=${gameId} players=[${playerIds.join(",")}] zones=[${zoneKeys.join(",")}]`);
    try {
      console.log(`[STATE_DEBUG] FULL ${prefix} gameId=${gameId} view=`, JSON.stringify(view));
    } catch (e) {
      console.log(`[STATE_DEBUG] FULL ${prefix} gameId=${gameId} view (stringify failed)`, view);
    }
  } catch (e) {
    // non-fatal
  }
}

/* ------------------- Core exported utilities (based on original file) ------------------- */

/**
 * Ensures that the specified game exists in both database and memory, creating it if necessary.
 * Prefer using the centralized GameManager to ensure consistent factory/reset behavior.
 * Falls back to the local create/replay flow if GameManager is not available or fails.
 *
 * Returns an InMemoryGame wrapper with a fully-initialized runtime state.
 */
export function ensureGame(gameId: string): InMemoryGame {
  // Defensive validation: reject invalid/falsy gameId early to prevent creating games with no id.
  if (!gameId || typeof gameId !== "string" || gameId.trim() === "") {
    const msg = `ensureGame called with invalid gameId: ${String(gameId)}`;
    console.error("[ensureGame] " + msg);
    // Throw so caller can handle — prevents creating an in-memory game with an invalid id
    throw new Error(msg);
  }

  // Prefer GameManager to keep a single source of truth for game creation/reset, if it's exposing helper methods.
  try {
    if (GameManager && typeof (GameManager as any).getGame === "function") {
      try {
        const gmGame = (GameManager as any).getGame(gameId) || (GameManager as any).ensureGame?.(gameId);
        if (gmGame) {
          // Keep the socket-level games map in sync with GameManager
          try { games.set(gameId, gmGame); } catch (e) { /* best-effort */ }
          // Ensure canonical state zones exist for players (defensive)
          try { ensureStateZonesForPlayers(gmGame); } catch {}
          return gmGame as InMemoryGame;
        }
      } catch (err) {
        console.warn("ensureGame: GameManager.getGame/ensureGame failed, falling back to local recreation:", err);
        // fall through to local approach
      }
    }
  } catch (err) {
    // If GameManager import or methods throw, fall back to local approach.
    console.warn("ensureGame: GameManager not usable, falling back:", err);
  }

  // Original fallback behavior: construct an in-memory game and replay persisted events.
  let game = games.get(gameId) as InMemoryGame | undefined;

  if (!game) {
    // Create an initial in-memory game wrapper (ctx + helpers).
    game = createInitialGameState(gameId) as InMemoryGame;

    // Ensure DB record exists (no-op if already present). Use safe defaults if state incomplete.
    try {
      const fmt = (game as any).state?.format ?? "commander";
      const startingLife = (game as any).state?.startingLife ?? 40;
      createGameIfNotExists(gameId, String(fmt), startingLife);
    } catch (err) {
      console.warn("ensureGame: createGameIfNotExists failed (continuing):", err);
    }

    // Replay persisted events into the newly created in-memory game to reconstruct state.
    try {
      const persisted = getEvents(gameId) || [];
      const replayEvents = persisted.map((ev: any) => ({ type: ev.type, ...(ev.payload || {}) }));
      if (typeof (game as any).replay === "function") {
        (game as any).replay(replayEvents);
      } else if (typeof (game as any).applyEvent === "function") {
        // fallback: apply events sequentially
        for (const e of replayEvents) {
          (game as any).applyEvent(e);
        }
      }
    } catch (err) {
      console.warn("ensureGame: replay persisted events failed, continuing with fresh state:", err);
    }

    // Ensure canonical in-memory zones exist for players so server modules don't later see undefined.
    try { ensureStateZonesForPlayers(game); } catch (e) { /* ignore */ }

    // Register reconstructed game in memory
    games.set(gameId, game);
  }

  return game;
}

/**
 * Broadcasts the full state of a game to all participants.
 * Uses the game's participants() method if available, otherwise falls back to participantsList.
 *
 * This version normalizes view and mirrors minimal zone shapes back into game.state so clients
 * and other server code never observe missing per-player zones.
 */
export function broadcastGame(io: Server, game: InMemoryGame, gameId: string) {
  let participants: Array<{ socketId: string; playerId: string; spectator: boolean }> = [];

  try {
    if (typeof (game as any).participants === "function") {
      participants = (game as any).participants();
    } else if ((game as any).participantsList && Array.isArray((game as any).participantsList)) {
      participants = (game as any).participantsList.slice();
    } else {
      participants = [];
    }
  } catch (err) {
    console.warn("broadcastGame: failed to obtain participants:", err);
    participants = [];
  }

  for (const p of participants) {
    try {
      let rawView;
      try {
        rawView = (typeof (game as any).viewFor === "function")
          ? (game as any).viewFor(p.playerId, !!p.spectator)
          : (game as any).state; // fallback: send raw state (not ideal, but defensive)
      } catch (e) {
        rawView = (game as any).state;
      }

      const view = normalizeViewForEmit(rawView, game);

      // Debug log per emission
      logStateDebug("BROADCAST_STATE", gameId, view);

      if (p.socketId) io.to(p.socketId).emit("state", { gameId, view, seq: (game as any).seq });
    } catch (err) {
      console.warn("broadcastGame: failed to send state to", p.socketId, err);
    }
  }
}

/**
 * Appends a game event (both in-memory and persisted to the DB).
 * This attempts to call game.applyEvent and then persists via appendEvent.
 */
export function appendGameEvent(
  game: InMemoryGame,
  gameId: string,
  type: string,
  payload: Record<string, any> = {}
) {
  try {
    if (typeof (game as any).applyEvent === "function") {
      (game as any).applyEvent({ type, ...payload });
    } else if (typeof (game as any).apply === "function") {
      (game as any).apply(type, payload);
    } else {
      // best-effort: mutate state if minimal apply API present
      if ((game as any).state && typeof (game as any).state === "object") {
        // no-op; rely on persisted events for reconstruction
      }
    }
  } catch (err) {
    console.warn("appendGameEvent: in-memory apply failed:", err);
  }

  try {
    appendEvent(gameId, (game as any).seq, type, payload);
  } catch (err) {
    console.warn("appendGameEvent: DB appendEvent failed:", err);
  }
}

/**
 * Clears the priority timer for a given Game ID.
 */
export function clearPriorityTimer(gameId: string) {
  const existingTimeout = priorityTimers.get(gameId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    priorityTimers.delete(gameId);
  }
}

/**
 * Schedules a priority pass timeout, automatically passing after the configured delay.
 * If the game has only one active player and a non-empty stack, passes immediately.
 */
export function schedulePriorityTimeout(
  io: Server,
  game: InMemoryGame,
  gameId: string
) {
  clearPriorityTimer(gameId);

  try {
    if (!game.state || !game.state.active || !game.state.priority) return;
  } catch {
    return;
  }

  const activePlayers = (game.state.players || []).filter((p: any) => !p.inactive);
  if (activePlayers.length === 1 && Array.isArray(game.state.stack) && game.state.stack.length > 0) {
    // schedule immediate auto-pass to resolve stack deterministically
    priorityTimers.set(
      gameId,
      setTimeout(() => {
        doAutoPass(io, game, gameId, "auto-pass (single player)");
      }, 0)
    );
    return;
  }

  const startSeq = (game as any).seq;
  const timeout = setTimeout(() => {
    priorityTimers.delete(gameId);
    const updatedGame = games.get(gameId);
    if (!updatedGame || (updatedGame as any).seq !== startSeq) return;
    doAutoPass(io, updatedGame, gameId, "auto-pass (timeout)");
  }, PRIORITY_TIMEOUT_MS);

  priorityTimers.set(gameId, timeout);
}

/**
 * Automatically passes the priority during a timeout.
 */
function doAutoPass(
  io: Server,
  game: InMemoryGame,
  gameId: string,
  reason: string
) {
  try {
    const playerId = game.state.priority;
    if (!playerId) return;

    // game.passPriority may not exist on some wrappers; call defensively
    let res: any = null;
    if (typeof (game as any).passPriority === "function") {
      res = (game as any).passPriority(playerId);
    } else if (typeof (game as any).nextPass === "function") {
      res = (game as any).nextPass(playerId);
    } else {
      console.warn("doAutoPass: game.passPriority not implemented for this game wrapper");
      return;
    }

    const changed = Boolean(res && (res.changed ?? true));
    const resolvedNow = Boolean(res && (res.resolvedNow ?? false));
    if (!changed) return;

    appendGameEvent(game, gameId, "passPriority", { by: playerId, reason });

    if (resolvedNow) {
      appendGameEvent(game, gameId, "resolveTopOfStack");
      try {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: "Top of stack resolved automatically.",
          ts: Date.now(),
        });
      } catch (err) {
        console.warn("doAutoPass: failed to emit chat", err);
      }
    }

    broadcastGame(io, game, gameId);
  } catch (err) {
    console.warn("doAutoPass: unexpected error", err);
  }
}

/**
 * Parses a string mana cost into its individual components (color distribution, generic mana, etc.).
 */
export function parseManaCost(
  manaCost?: string
): {
  colors: Record<string, number>;
  generic: number;
  hybrids: Array<Array<string>>;
  hasX: boolean;
} {
  const result = {
    colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    generic: 0,
    hybrids: [] as Array<Array<string>>,
    hasX: false,
  };

  if (!manaCost) return result;

  const tokens = manaCost.match(/\{[^}]+\}/g) || [];
  for (const token of tokens) {
    const clean = token.replace(/[{}]/g, "").toUpperCase();
    if (clean === "X") {
      result.hasX = true;
    } else if (/^\d+$/.test(clean)) {
      result.generic += parseInt(clean, 10);
    } else if (clean.includes("/")) {
      const parts = clean.split("/");
      result.hybrids.push(parts);
    } else if (clean.length === 1 && result.colors.hasOwnProperty(clean)) {
      (result.colors as any)[clean] = ((result.colors as any)[clean] || 0) + 1;
    } else {
      // treat unknown symbol as generic fallback (conservative)
      result.generic += 0;
    }
  }

  return result;
}