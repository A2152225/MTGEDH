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
import { games, priorityTimers, PRIORITY_TIMEOUT_MS } from "./socket.js";
import { appendEvent, createGameIfNotExists, getEvents } from "../db/index.js";
import { createInitialGameState } from "../state/index.js";
import type { InMemoryGame } from "../state/types.js";
import { GameManager } from "../GameManager.js";
import type { GameID, PlayerID } from "../../../shared/src/index.js";

/* ------------------- Defensive normalization helpers ------------------- */

/** canonical minimal zone shape for a player */
function defaultPlayerZones() {
  return {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  };
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
        z.handCount =
          typeof z.handCount === "number"
            ? z.handCount
            : Array.isArray(z.hand)
            ? z.hand.length
            : 0;
        z.library = Array.isArray(z.library) ? z.library : [];
        z.libraryCount =
          typeof z.libraryCount === "number"
            ? z.libraryCount
            : Array.isArray(z.library)
            ? z.library.length
            : 0;
        z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
        z.graveyardCount =
          typeof z.graveyardCount === "number"
            ? z.graveyardCount
            : Array.isArray(z.graveyard)
            ? z.graveyard.length
            : 0;
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
        : game &&
          game.state &&
          Array.isArray(game.state.players)
        ? game.state.players
        : [];
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
            dst.hand = Array.isArray(dst.hand)
              ? dst.hand
              : Array.isArray(src.hand)
              ? src.hand
              : [];
            dst.handCount =
              typeof dst.handCount === "number"
                ? dst.handCount
                : Array.isArray(dst.hand)
                ? dst.hand.length
                : 0;
            dst.library = Array.isArray(dst.library)
              ? dst.library
              : Array.isArray(src.library)
              ? src.library
              : [];
            dst.libraryCount =
              typeof dst.libraryCount === "number"
                ? dst.libraryCount
                : Array.isArray(dst.library)
                ? dst.library.length
                : 0;
            dst.graveyard = Array.isArray(dst.graveyard)
              ? dst.graveyard
              : Array.isArray(src.graveyard)
              ? src.graveyard
              : [];
            dst.graveyardCount =
              typeof dst.graveyardCount === "number"
                ? dst.graveyardCount
                : Array.isArray(dst.graveyard)
                ? dst.graveyard.length
                : 0;
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

    const playerIds = Array.isArray(view?.players)
      ? view.players.map((p: any) => p?.id ?? p?.playerId)
      : [];
    const zoneKeys = view?.zones ? Object.keys(view.zones) : [];

    // Pick the first player (if any) and derive a compact summary
    const firstPid = playerIds[0];
    const z = firstPid && view?.zones ? view.zones[firstPid] : null;
    const lib = z && Array.isArray(z.library) ? z.library : [];
    const firstLib = lib[0];
    const lastLib =
      lib.length > 1 ? lib[lib.length - 1] : lib.length === 1 ? lib[0] : null;

    console.log(
      `[STATE_DEBUG] ${prefix} gameId=${gameId} players=[${playerIds.join(
        ","
      )}] zones=[${zoneKeys.join(
        ","
      )}] handCount=${z?.handCount ?? 0} libraryCount=${z?.libraryCount ?? 0}`
    );

    // Compact library sample instead of full JSON dump
    console.log(`[STATE_DEBUG] ${prefix} librarySample gameId=${gameId}`, {
      firstLibraryCard: firstLib
        ? {
            id: firstLib.id,
            name: firstLib.name,
            type_line: firstLib.type_line,
          }
        : null,
      lastLibraryCard: lastLib
        ? {
            id: lastLib.id,
            name: lastLib.name,
            type_line: lastLib.type_line,
          }
        : null,
    });
  } catch (e) {
    // non-fatal
  }
}

/**
 * Get player name from player ID.
 * Falls back to the ID if name is not found.
 */
export function getPlayerName(game: any, playerId: PlayerID): string {
  if (!game || !playerId) return playerId || 'Unknown';
  try {
    const players = game.state?.players || [];
    const player = players.find((p: any) => p?.id === playerId);
    return player?.name || playerId;
  } catch (e) {
    return playerId || 'Unknown';
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
    throw new Error(msg);
  }

  // Prefer GameManager to keep a single source of truth for game creation/reset, if it's exposing helper methods.
  try {
    if (GameManager && typeof (GameManager as any).getGame === "function") {
      try {
        const gmGame =
          (GameManager as any).getGame(gameId) ||
          (GameManager as any).ensureGame?.(gameId);
        if (gmGame) {
          try {
            games.set(gameId, gmGame);
          } catch {
            /* best-effort */
          }
          try {
            ensureStateZonesForPlayers(gmGame);
          } catch {
            /* ignore */
          }
          return gmGame as InMemoryGame;
        }
      } catch (err) {
        console.warn(
          "ensureGame: GameManager.getGame/ensureGame failed, falling back to local recreation:",
          err
        );
      }
    }
  } catch (err) {
    console.warn("ensureGame: GameManager not usable, falling back:", err);
  }

  // Original fallback behavior
  let game = games.get(gameId) as InMemoryGame | undefined;

  if (!game) {
    game = createInitialGameState(gameId) as InMemoryGame;

    try {
      const fmt = (game as any).state?.format ?? "commander";
      const startingLife = (game as any).state?.startingLife ?? 40;
      createGameIfNotExists(gameId, String(fmt), startingLife);
    } catch (err) {
      console.warn(
        "ensureGame: createGameIfNotExists failed (continuing):",
        err
      );
    }

    try {
      const persisted = getEvents(gameId) || [];
      const replayEvents = persisted.map((ev: any) => ({
        type: ev.type,
        ...(ev.payload || {}),
      }));
      if (typeof (game as any).replay === "function") {
        (game as any).replay(replayEvents);
      } else if (typeof (game as any).applyEvent === "function") {
        for (const e of replayEvents) {
          (game as any).applyEvent(e);
        }
      }
    } catch (err) {
      console.warn(
        "ensureGame: replay persisted events failed, continuing with fresh state:",
        err
      );
    }

    try {
      ensureStateZonesForPlayers(game);
    } catch {
      /* ignore */
    }

    games.set(gameId, game);
  }

  return game;
}

/**
 * Emit a full, normalized state snapshot directly to a specific socketId for a given game,
 * using the same normalization semantics as other emitters.
 */
export function emitStateToSocket(
  io: Server,
  gameId: GameID,
  socketId: string,
  playerId?: PlayerID
) {
  try {
    const game = games.get(gameId);
    if (!game) return;

    let rawView: any;
    try {
      if (typeof (game as any).viewFor === "function" && playerId) {
        rawView = (game as any).viewFor(playerId, false);
      } else if (typeof (game as any).viewFor === "function") {
        const statePlayers: any[] = (game as any).state?.players || [];
        const firstId: string | undefined = statePlayers[0]?.id;
        rawView = firstId
          ? (game as any).viewFor(firstId, false)
          : (game as any).state;
      } else {
        rawView = (game as any).state;
      }
    } catch {
      rawView = (game as any).state;
    }

    const view = normalizeViewForEmit(rawView, game);
    try {
      io.to(socketId).emit("state", {
        gameId,
        view,
        seq: (game as any).seq || 0,
      });
    } catch (e) {
      console.warn(
        "emitStateToSocket: failed to emit state to socket",
        socketId,
        e
      );
    }
  } catch (e) {
    console.warn("emitStateToSocket: failed to build or emit view", e);
  }
}

/**
 * Broadcasts the full state of a game to all participants.
 * Uses the game's participants() method if available, otherwise falls back to participantsList.
 *
 * This version normalizes view and mirrors minimal zone shapes back into game.state so clients
 * and other server code never observe missing per-player zones.
 */
export function broadcastGame(
  io: Server,
  game: InMemoryGame,
  gameId: string
) {
  let participants:
    | Array<{
        socketId: string;
        playerId: string;
        spectator: boolean;
      }>
    | null = null;

  try {
    if (typeof (game as any).participants === "function") {
      participants = (game as any).participants();
    } else if (
      (game as any).participantsList &&
      Array.isArray((game as any).participantsList)
    ) {
      participants = (game as any).participantsList.slice();
    } else {
      participants = [];
    }
  } catch (err) {
    console.warn("broadcastGame: failed to obtain participants:", err);
    participants = [];
  }

  let anySent = false;

  if (participants && participants.length) {
    for (const p of participants) {
      try {
        let rawView;
        try {
          rawView =
            typeof (game as any).viewFor === "function"
              ? (game as any).viewFor(p.playerId, !!p.spectator)
              : (game as any).state;
        } catch {
          rawView = (game as any).state;
        }

        const view = normalizeViewForEmit(rawView, game);

        logStateDebug("BROADCAST_STATE", gameId, view);

        if (p.socketId) {
          io.to(p.socketId).emit("state", {
            gameId,
            view,
            seq: (game as any).seq,
          });
          anySent = true;
        }
      } catch (err) {
        console.warn(
          "broadcastGame: failed to send state to",
          p.socketId,
          err
        );
      }
    }
  }

  // Fallback: if we had no participants or failed to send to anyone,
  // emit to the entire game room so rejoined sockets still receive updates.
  if (!anySent) {
    try {
      let rawView: any;
      try {
        if (typeof (game as any).viewFor === "function") {
          const statePlayers: any[] = (game as any).state?.players || [];
          const firstId: string | undefined = statePlayers[0]?.id;
          rawView = firstId
            ? (game as any).viewFor(firstId, false)
            : (game as any).state;
        } else {
          rawView = (game as any).state;
        }
      } catch {
        rawView = (game as any).state;
      }

      const view = normalizeViewForEmit(rawView, game);
      logStateDebug("BROADCAST_STATE", gameId, view);
      io.to(gameId).emit("state", {
        gameId,
        view,
        seq: (game as any).seq,
      });
    } catch (err) {
      console.warn(
        "broadcastGame: fallback emit to room failed for gameId",
        gameId,
        err
      );
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

  const activePlayers = (game.state.players || []).filter(
    (p: any) => !p.inactive
  );
  if (
    activePlayers.length === 1 &&
    Array.isArray(game.state.stack) &&
    game.state.stack.length > 0
  ) {
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
      console.warn(
        "doAutoPass: game.passPriority not implemented for this game wrapper"
      );
      return;
    }

    const changed = Boolean(res && (res.changed ?? true));
    const resolvedNow = Boolean(res && (res.resolvedNow ?? false));
    if (!changed) return;

    appendGameEvent(game, gameId, "passPriority", { by: playerId, reason });

    if (resolvedNow) {
      // Directly call resolveTopOfStack to ensure the spell resolves
      if (typeof (game as any).resolveTopOfStack === "function") {
        (game as any).resolveTopOfStack();
        console.log(`[doAutoPass] Stack resolved for game ${gameId}`);
      }
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
 * Maps mana color symbols to their human-readable names.
 */
export const MANA_COLOR_NAMES: Record<string, string> = {
  'W': 'white',
  'U': 'blue',
  'B': 'black',
  'R': 'red',
  'G': 'green',
  'C': 'colorless',
};

/**
 * Standard mana color symbols in WUBRG order plus colorless.
 */
export const MANA_COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
export type ManaColorSymbol = typeof MANA_COLORS[number];

/**
 * Gets the human-readable name for a mana color symbol.
 */
export function getManaColorName(symbol: string): string {
  return MANA_COLOR_NAMES[symbol] || symbol.toLowerCase();
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
    } else if (clean.length === 1 && (result.colors as any).hasOwnProperty(clean)) {
      (result.colors as any)[clean] =
        ((result.colors as any)[clean] || 0) + 1;
    } else {
      // unknown symbol -> ignore for now
      result.generic += 0;
    }
  }

  return result;
}

/**
 * Consumes mana from a player's mana pool to pay for a spell cost.
 * Returns the remaining mana in the pool after payment.
 * 
 * This function first consumes colored mana requirements, then uses remaining mana
 * (preferring colorless) to pay for generic costs. Any unspent mana remains in the pool
 * for subsequent spells.
 * 
 * @param pool - The player's mana pool (will be modified in place)
 * @param coloredCost - The colored mana requirements (e.g., { W: 1, U: 1, ... })
 * @param genericCost - The amount of generic mana required
 * @param logPrefix - Optional prefix for debug logging
 * @returns The mana consumed and remaining in pool
 */
export function consumeManaFromPool(
  pool: Record<string, number>,
  coloredCost: Record<string, number>,
  genericCost: number,
  logPrefix?: string
): { consumed: Record<string, number>; remaining: Record<string, number> } {
  const consumed: Record<string, number> = {
    white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
  };
  
  // First, consume colored mana requirements
  for (const color of MANA_COLORS) {
    const colorKey = MANA_COLOR_NAMES[color];
    const needed = coloredCost[color] || 0;
    if (needed > 0 && colorKey && pool[colorKey] >= needed) {
      pool[colorKey] -= needed;
      consumed[colorKey] = (consumed[colorKey] || 0) + needed;
      if (logPrefix) {
        console.log(`${logPrefix} Consumed ${needed} ${color} mana from pool`);
      }
    }
  }
  
  // Then, consume generic mana (use any available mana, preferring colorless first)
  let genericLeft = genericCost;
  
  // First use colorless
  if (genericLeft > 0 && pool.colorless > 0) {
    const useColorless = Math.min(pool.colorless, genericLeft);
    pool.colorless -= useColorless;
    consumed.colorless = (consumed.colorless || 0) + useColorless;
    genericLeft -= useColorless;
    if (logPrefix) {
      console.log(`${logPrefix} Consumed ${useColorless} colorless mana for generic cost`);
    }
  }
  
  // Then use other colors
  for (const color of MANA_COLORS) {
    if (genericLeft <= 0) break;
    const colorKey = MANA_COLOR_NAMES[color];
    if (colorKey && pool[colorKey] > 0) {
      const useColor = Math.min(pool[colorKey], genericLeft);
      pool[colorKey] -= useColor;
      consumed[colorKey] = (consumed[colorKey] || 0) + useColor;
      genericLeft -= useColor;
      if (logPrefix) {
        console.log(`${logPrefix} Consumed ${useColor} ${color} mana for generic cost`);
      }
    }
  }
  
  // Log remaining mana in pool
  if (logPrefix) {
    const remainingMana = Object.entries(pool).filter(([_, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(', ');
    if (remainingMana) {
      console.log(`${logPrefix} Unspent mana remaining in pool: ${remainingMana}`);
    }
  }
  
  return { consumed, remaining: { ...pool } };
}

/**
 * Gets the current mana pool for a player, initializing it if needed.
 */
export function getOrInitManaPool(
  gameState: any,
  playerId: string
): Record<string, number> {
  gameState.manaPool = gameState.manaPool || {};
  gameState.manaPool[playerId] = gameState.manaPool[playerId] || {
    white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
  };
  return gameState.manaPool[playerId];
}

/**
 * Calculates the total available mana by combining existing pool with new payment.
 * Returns the combined pool in the same format as the mana pool (using color names as keys).
 */
export function calculateTotalAvailableMana(
  existingPool: Record<string, number>,
  newPayment: Array<{ mana: string }> | undefined
): Record<string, number> {
  // Start with a copy of the existing pool
  const total: Record<string, number> = {
    white: existingPool.white || 0,
    blue: existingPool.blue || 0,
    black: existingPool.black || 0,
    red: existingPool.red || 0,
    green: existingPool.green || 0,
    colorless: existingPool.colorless || 0,
  };
  
  // Add new payment
  if (newPayment && newPayment.length > 0) {
    for (const p of newPayment) {
      const colorKey = MANA_COLOR_NAMES[p.mana];
      if (colorKey) {
        total[colorKey] = (total[colorKey] || 0) + 1;
      }
    }
  }
  
  return total;
}

/**
 * Validates if the total available mana (existing pool + new payment) can pay for a spell.
 * Returns null if payment is sufficient, or an error message describing what's missing.
 */
export function validateManaPayment(
  totalAvailable: Record<string, number>,
  coloredCost: Record<string, number>,
  genericCost: number
): string | null {
  const pool = { ...totalAvailable };
  const missingColors: string[] = [];
  
  // Check colored requirements
  for (const color of MANA_COLORS) {
    const colorKey = MANA_COLOR_NAMES[color];
    const needed = coloredCost[color] || 0;
    const available = pool[colorKey] || 0;
    
    if (available < needed) {
      missingColors.push(`${needed - available} ${getManaColorName(color)}`);
    } else {
      // Reserve this mana for the colored cost
      pool[colorKey] -= needed;
    }
  }
  
  // Check generic requirement with remaining mana
  const remainingTotal = Object.values(pool).reduce((a, b) => a + b, 0);
  const missingGeneric = Math.max(0, genericCost - remainingTotal);
  
  if (missingColors.length > 0 || missingGeneric > 0) {
    let errorMsg = "Insufficient mana.";
    if (missingColors.length > 0) {
      errorMsg += ` Missing: ${missingColors.join(', ')}.`;
    }
    if (missingGeneric > 0) {
      errorMsg += ` Missing ${missingGeneric} generic mana.`;
    }
    return errorMsg;
  }
  
  return null;
}