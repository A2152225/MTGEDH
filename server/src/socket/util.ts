// server/src/socket/util.ts
// Socket helper utilities used by server socket handlers.
// Provides: ensureGame (create/replay), broadcastGame, appendGameEvent,
// priority timer scheduling (schedulePriorityTimeout + doAutoPass),
// clearPriorityTimer, parseManaCost helper, and transformDbEventsForReplay.
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

// ============================================================================
// Pre-compiled RegExp patterns for mana color matching in devotion calculations
// Optimization: Created once at module load instead of inside loops
// ============================================================================
const DEVOTION_COLOR_PATTERNS: Record<string, RegExp> = {
  W: /\{W\}/gi,
  U: /\{U\}/gi,
  B: /\{B\}/gi,
  R: /\{R\}/gi,
  G: /\{G\}/gi,
};

/* ------------------- Event transformation helpers ------------------- */

/**
 * Transform events from DB format { type, payload } to replay format { type, ...payload }
 * This is used when replaying events after a server restart or during undo.
 * 
 * DB format: { type: 'playLand', payload: { playerId: 'p1', cardId: 'c1' } }
 * Replay format: { type: 'playLand', playerId: 'p1', cardId: 'c1' }
 */
export function transformDbEventsForReplay(events: Array<{ type: string; payload?: any }>): any[] {
  return events.map((e: any) =>
    e && e.type
      ? e.payload && typeof e.payload === "object"
        ? { type: e.type, ...(e.payload as any) }
        : { type: e.type }
      : e
  );
}

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
    game.state = (game.state || {}) as any;
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
 * Options for ensureGame when creating a new game with creator tracking.
 */
export interface EnsureGameOptions {
  createdBySocketId?: string;
  createdByPlayerId?: string;
}

/**
 * Ensures that the specified game exists in both database and memory, creating it if necessary.
 * Prefer using the centralized GameManager to ensure consistent factory/reset behavior.
 * Falls back to the local create/replay flow if GameManager is not available or fails.
 *
 * Returns an InMemoryGame wrapper with a fully-initialized runtime state.
 */
export function ensureGame(gameId: string, options?: EnsureGameOptions): InMemoryGame {
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
      createGameIfNotExists(
        gameId, 
        String(fmt), 
        startingLife,
        options?.createdBySocketId,
        options?.createdByPlayerId
      );
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
 * 
 * After broadcasting, checks if the current priority holder is an AI player
 * and triggers AI handling if needed.
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
  
  // After broadcasting, check if the current priority holder is an AI player
  // This ensures AI responds to game state changes
  checkAndTriggerAI(io, game, gameId);
}

/** AI reaction delay - matches timing in ai.ts */
const AI_REACTION_DELAY_MS = 300;

/**
 * Check if the current priority holder is an AI and trigger their turn
 * This is called after broadcasting to ensure AI reacts to state changes
 */
function checkAndTriggerAI(io: Server, game: InMemoryGame, gameId: string): void {
  try {
    const priority = (game.state as any)?.priority;
    if (!priority) return;
    
    // Check if the current priority holder is an AI player
    const players = (game.state as any)?.players || [];
    const priorityPlayer = players.find((p: any) => p?.id === priority);
    
    if (priorityPlayer && priorityPlayer.isAI) {
      // Dynamically import AI handler to avoid circular deps
      setTimeout(async () => {
        try {
          const aiModule = await import('./ai.js');
          if (typeof aiModule.handleAIGameFlow === 'function') {
            await aiModule.handleAIGameFlow(io, gameId, priority);
          } else if (typeof aiModule.handleAIPriority === 'function') {
            await aiModule.handleAIPriority(io, gameId, priority);
          }
        } catch (e) {
          console.warn('[util] Failed to trigger AI handler:', e);
        }
      }, AI_REACTION_DELAY_MS);
    }
  } catch (e) {
    console.warn('[util] checkAndTriggerAI error:', e);
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
      
      // Check for pending library search (from tutor spells)
      handlePendingLibrarySearch(io, game, gameId);
      
      // Check for pending Entrapment Maneuver
      handlePendingEntrapmentManeuver(io, game, gameId);
    }

    broadcastGame(io, game, gameId);
  } catch (err) {
    console.warn("doAutoPass: unexpected error", err);
  }
}

// ============================================================================
// Library Search Restriction Handling (Aven Mindcensor, Stranglehold, etc.)
// ============================================================================

/** Known cards that prevent or restrict library searching */
const SEARCH_PREVENTION_CARDS: Record<string, { affectsOpponents: boolean; affectsSelf: boolean }> = {
  "stranglehold": { affectsOpponents: true, affectsSelf: false },
  "ashiok, dream render": { affectsOpponents: true, affectsSelf: false },
  "mindlock orb": { affectsOpponents: true, affectsSelf: true },
  "shadow of doubt": { affectsOpponents: true, affectsSelf: true },
  "leonin arbiter": { affectsOpponents: true, affectsSelf: true }, // Can pay {2}
};

/** Known cards that limit library searching to top N cards */
const SEARCH_LIMIT_CARDS: Record<string, { limit: number; affectsOpponents: boolean }> = {
  "aven mindcensor": { limit: 4, affectsOpponents: true },
};

/** Known cards that trigger when opponents search */
const SEARCH_TRIGGER_CARDS: Record<string, { effect: string; affectsOpponents: boolean }> = {
  "ob nixilis, unshackled": { effect: "Sacrifice a creature and lose 10 life", affectsOpponents: true },
};

/** Known cards that give control during opponent's search */
const SEARCH_CONTROL_CARDS = new Set(["opposition agent"]);

/**
 * Check for search restrictions affecting a player
 */
export function checkLibrarySearchRestrictions(
  game: any,
  searchingPlayerId: string
): {
  canSearch: boolean;
  limitToTop?: number;
  triggerEffects: { cardName: string; effect: string; controllerId: string }[];
  controlledBy?: string;
  reason?: string;
  paymentRequired?: { cardName: string; amount: string };
} {
  const battlefield = game.state?.battlefield || [];
  const triggerEffects: { cardName: string; effect: string; controllerId: string }[] = [];
  let canSearch = true;
  let limitToTop: number | undefined;
  let controlledBy: string | undefined;
  let reason: string | undefined;
  let paymentRequired: { cardName: string; amount: string } | undefined;
  
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const cardName = (perm.card.name || "").toLowerCase();
    const controllerId = perm.controller;
    const isOpponent = controllerId !== searchingPlayerId;
    
    // Check prevention cards
    for (const [name, info] of Object.entries(SEARCH_PREVENTION_CARDS)) {
      if (cardName.includes(name)) {
        const applies = (isOpponent && info.affectsOpponents) || (!isOpponent && info.affectsSelf);
        if (applies) {
          // Special case: Leonin Arbiter allows payment
          if (name === "leonin arbiter") {
            paymentRequired = { cardName: perm.card.name, amount: "{2}" };
          } else {
            canSearch = false;
            reason = `${perm.card.name} prevents library searching`;
          }
        }
      }
    }
    
    // Check limit cards (Aven Mindcensor)
    for (const [name, info] of Object.entries(SEARCH_LIMIT_CARDS)) {
      if (cardName.includes(name)) {
        if (isOpponent && info.affectsOpponents) {
          if (limitToTop === undefined || info.limit < limitToTop) {
            limitToTop = info.limit;
          }
        }
      }
    }
    
    // Check trigger cards (Ob Nixilis)
    for (const [name, info] of Object.entries(SEARCH_TRIGGER_CARDS)) {
      if (cardName.includes(name)) {
        if (isOpponent && info.affectsOpponents) {
          triggerEffects.push({
            cardName: perm.card.name,
            effect: info.effect,
            controllerId,
          });
        }
      }
    }
    
    // Check control cards (Opposition Agent)
    if (SEARCH_CONTROL_CARDS.has(cardName)) {
      if (isOpponent) {
        controlledBy = controllerId;
      }
    }
  }
  
  return {
    canSearch,
    limitToTop,
    triggerEffects,
    controlledBy,
    reason,
    paymentRequired,
  };
}

/**
 * Handle pending library search effects (from tutor spells like Demonic Tutor, Vampiric Tutor, etc.)
 * This checks the game state for pendingLibrarySearch and emits librarySearchRequest to the appropriate player.
 */
export function handlePendingLibrarySearch(io: Server, game: any, gameId: string): void {
  try {
    const pending = game.state?.pendingLibrarySearch;
    if (!pending || typeof pending !== 'object') return;
    
    // Get the socket map for this game
    const socketsByPlayer: Map<string, any> = (game as any).participantSockets || new Map();
    
    // Maximum number of cards to search when looking through library
    const MAX_LIBRARY_SEARCH_RESULTS = 1000;
    
    for (const [playerId, searchInfo] of Object.entries(pending)) {
      if (!searchInfo) continue;
      
      const info = searchInfo as any;
      
      // Get the player's library for searching
      let library: any[] = [];
      if (typeof game.searchLibrary === 'function') {
        library = game.searchLibrary(playerId, '', MAX_LIBRARY_SEARCH_RESULTS);
      } else {
        library = ((game as any).libraries?.get(playerId)) || [];
      }
      
      // Check for search restrictions (Aven Mindcensor, Stranglehold, etc.)
      const searchCheck = checkLibrarySearchRestrictions(game, playerId);
      
      // If search is prevented, still shuffle but fail search
      if (!searchCheck.canSearch) {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)}'s search was prevented by ${searchCheck.reason}. Library shuffled.`,
          ts: Date.now(),
        });
        
        // Still shuffle the library
        if (typeof game.shuffleLibrary === "function") {
          game.shuffleLibrary(playerId);
        }
        
        continue;
      }
      
      // Apply Aven Mindcensor effect if present
      const searchableCards = searchCheck.limitToTop 
        ? library.slice(0, searchCheck.limitToTop)
        : library;
      
      // If there are trigger effects (Ob Nixilis), notify
      if (searchCheck.triggerEffects.length > 0) {
        for (const trigger of searchCheck.triggerEffects) {
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${trigger.cardName} triggers: ${trigger.effect}`,
            ts: Date.now(),
          });
        }
      }
      
      // Use provided filter if available (from fetch lands), otherwise parse from searchFor
      const filter = info.filter || parseSearchFilter(info.searchFor || 'card');
      
      // Build description with restriction info
      let description = info.searchFor ? `Search for: ${info.searchFor}` : 'Search your library';
      if (searchCheck.limitToTop) {
        description = `${description} (Aven Mindcensor: top ${searchCheck.limitToTop} cards only)`;
      }
      
      // Get the socket for this player and emit search request
      const socket = socketsByPlayer.get(playerId);
      
      // Build the base request object
      const baseRequest = {
        gameId,
        cards: searchableCards,
        title: info.source || 'Search',
        description,
        filter,
        maxSelections: info.maxSelections || 1,
        moveTo: info.splitDestination ? 'split' : (info.destination || 'hand'),
        shuffleAfter: info.shuffleAfter ?? true,
        optional: info.optional || false,
        tapped: info.tapped || false,
        // For split-destination effects (Kodama's Reach, Cultivate)
        splitDestination: info.splitDestination || false,
        toBattlefield: info.toBattlefield,
        toHand: info.toHand,
        entersTapped: info.entersTapped,
        searchRestrictions: {
          limitedToTop: searchCheck.limitToTop,
          paymentRequired: searchCheck.paymentRequired,
          triggerEffects: searchCheck.triggerEffects,
        },
      };
      
      if (socket) {
        socket.emit("librarySearchRequest", baseRequest);
        
        console.log(`[handlePendingLibrarySearch] Sent librarySearchRequest to ${playerId} for ${info.source || 'tutor'}${info.splitDestination ? ' (split destination)' : ''}`);
      } else {
        // No specific socket - broadcast to the room and let the client filter
        io.to(gameId).emit("librarySearchRequest", {
          ...baseRequest,
          playerId,
        });
        
        console.log(`[handlePendingLibrarySearch] Broadcast librarySearchRequest for ${playerId} for ${info.source || 'tutor'}${info.splitDestination ? ' (split destination)' : ''}`);
      }
    }
    
    // Clear the pending search after emitting requests
    game.state.pendingLibrarySearch = {};
    
  } catch (err) {
    console.warn('[handlePendingLibrarySearch] Error:', err);
  }
}

/**
 * Handle pending Entrapment Maneuver effects (target player sacrifices an attacking creature,
 * then caster creates tokens equal to toughness)
 */
function handlePendingEntrapmentManeuver(io: Server, game: any, gameId: string): void {
  try {
    const pending = game.state?.pendingEntrapmentManeuver;
    if (!pending || typeof pending !== 'object') return;
    
    // Get the socket map for this game
    const socketsByPlayer: Map<string, any> = (game as any).participantSockets || new Map();
    
    for (const [playerId, maneuverInfo] of Object.entries(pending)) {
      if (!maneuverInfo) continue;
      
      const info = maneuverInfo as any;
      
      // Emit sacrifice selection request to the player who must sacrifice
      const socket = socketsByPlayer.get(playerId);
      
      const sacrificeRequest = {
        gameId,
        playerId,
        source: info.source || 'Entrapment Maneuver',
        caster: info.caster,
        creatures: info.attackingCreatures || [],
        reason: "Choose an attacking creature to sacrifice",
        type: "entrapment_maneuver",
      };
      
      if (socket) {
        socket.emit("entrapmentManeuverSacrificeRequest", sacrificeRequest);
        console.log(`[handlePendingEntrapmentManeuver] Sent sacrifice request to ${playerId}`);
      } else {
        // Broadcast to the room and let client filter
        io.to(gameId).emit("entrapmentManeuverSacrificeRequest", sacrificeRequest);
        console.log(`[handlePendingEntrapmentManeuver] Broadcast sacrifice request for ${playerId}`);
      }
      
      // Emit chat message
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} must sacrifice an attacking creature (${info.source}).`,
        ts: Date.now(),
      });
    }
    
    // Don't clear pending yet - it will be cleared when player makes their choice
    
  } catch (err) {
    console.warn('[handlePendingEntrapmentManeuver] Error:', err);
  }
}

/**
 * Parse search criteria string into a filter object for library search.
 * E.g., "basic land card" -> { types: ['land'], supertypes: ['basic'] }
 * E.g., "planeswalker card" -> { types: ['planeswalker'] }
 * 
 * The filter format must match LibrarySearchModalProps['filter']:
 * - types: string[] (e.g., ['creature', 'planeswalker'])
 * - subtypes: string[] (e.g., ['forest', 'equipment'])
 * - supertypes: string[] (e.g., ['basic', 'legendary'])
 * - maxCmc: number
 */
function parseSearchFilter(criteria: string): { types?: string[]; subtypes?: string[]; supertypes?: string[]; maxCmc?: number } {
  if (!criteria) return {};
  
  const filter: { types?: string[]; subtypes?: string[]; supertypes?: string[]; maxCmc?: number } = {};
  const text = criteria.toLowerCase();
  
  // Card types - must be in types array for client filter to work
  const types: string[] = [];
  if (text.includes('creature')) types.push('creature');
  if (text.includes('instant')) types.push('instant');
  if (text.includes('sorcery')) types.push('sorcery');
  if (text.includes('artifact')) types.push('artifact');
  if (text.includes('enchantment')) types.push('enchantment');
  if (text.includes('planeswalker')) types.push('planeswalker');
  if (text.includes('land')) types.push('land');
  
  if (types.length > 0) {
    filter.types = types;
  }
  
  // Supertypes
  const supertypes: string[] = [];
  if (text.includes('basic')) supertypes.push('basic');
  if (text.includes('legendary')) supertypes.push('legendary');
  if (text.includes('snow')) supertypes.push('snow');
  
  if (supertypes.length > 0) {
    filter.supertypes = supertypes;
  }
  
  // Subtypes (land types, creature types, etc.)
  const subtypes: string[] = [];
  if (text.includes('forest')) subtypes.push('forest');
  if (text.includes('plains')) subtypes.push('plains');
  if (text.includes('island')) subtypes.push('island');
  if (text.includes('swamp')) subtypes.push('swamp');
  if (text.includes('mountain')) subtypes.push('mountain');
  if (text.includes('equipment')) subtypes.push('equipment');
  
  if (subtypes.length > 0) {
    filter.subtypes = subtypes;
  }
  
  // CMC restrictions
  const cmcMatch = text.match(/mana value (\d+) or less/);
  if (cmcMatch) {
    filter.maxCmc = parseInt(cmcMatch[1], 10);
  }
  
  return filter;
}

/**
 * Handle pending Join Forces effects after stack resolution.
 * When a Join Forces spell resolves, this emits the joinForcesRequest event
 * to all players so they can contribute mana.
 */
export function handlePendingJoinForces(io: Server, game: any, gameId: string): void {
  try {
    const pendingArray = game.state?.pendingJoinForces;
    if (!pendingArray || !Array.isArray(pendingArray) || pendingArray.length === 0) return;
    
    // Get all non-spectator players
    const players = (game.state?.players || [])
      .filter((p: any) => p && !p.spectator)
      .map((p: any) => p.id);
    
    if (players.length === 0) {
      // No players to participate
      game.state.pendingJoinForces = [];
      return;
    }
    
    for (const jf of pendingArray) {
      if (!jf) continue;
      
      const { id, controller, cardName, effectDescription, imageUrl } = jf;
      
      // Emit Join Forces request to all players
      io.to(gameId).emit("joinForcesRequest", {
        id,
        gameId,
        initiator: controller,
        initiatorName: getPlayerName(game, controller),
        cardName,
        effectDescription,
        cardImageUrl: imageUrl,
        players,
        timeoutMs: 60000, // 60 second timeout
      });
      
      // Chat notification
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `🤝 ${getPlayerName(game, controller)} casts ${cardName} - all players may contribute mana!`,
        ts: Date.now(),
      });
      
      console.log(`[handlePendingJoinForces] Emitted joinForcesRequest for ${cardName} by ${controller}`);
    }
    
    // Clear pending Join Forces after emitting
    game.state.pendingJoinForces = [];
    
  } catch (err) {
    console.warn('[handlePendingJoinForces] Error:', err);
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
 * Gets the "doesn't empty" mana pool for a player (mana that persists until end of turn).
 * Used by cards like Grand Warlord Radha, Savage Ventmaw, Neheb, Omnath, etc.
 */
export function getOrInitPersistentManaPool(
  gameState: any,
  playerId: string
): Record<string, number> {
  gameState.persistentManaPool = gameState.persistentManaPool || {};
  gameState.persistentManaPool[playerId] = gameState.persistentManaPool[playerId] || {
    white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
  };
  return gameState.persistentManaPool[playerId];
}

/**
 * Mana retention effects from permanents on the battlefield.
 * 
 * Types of effects:
 * - "doesn't empty" - specific color(s) don't empty (Omnath, Leyline Tyrant)
 * - "becomes colorless" - unspent mana becomes colorless instead of emptying (Kruphix, Horizon Stone)
 * - "all mana doesn't empty" - no mana empties (Upwelling)
 */
export interface ManaRetentionEffect {
  permanentId: string;
  cardName: string;
  type: 'doesnt_empty' | 'becomes_colorless' | 'all_doesnt_empty';
  colors?: string[]; // Which colors are affected (undefined = all)
}

/**
 * Detect mana retention effects from battlefield permanents
 */
export function detectManaRetentionEffects(
  gameState: any,
  playerId: string
): ManaRetentionEffect[] {
  const effects: ManaRetentionEffect[] = [];
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
    
    // Omnath, Locus of Mana - Green mana doesn't empty
    if (cardName.includes("omnath, locus of mana") || 
        (oracleText.includes("green mana") && oracleText.includes("doesn't empty"))) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Omnath",
        type: 'doesnt_empty',
        colors: ['green'],
      });
    }
    
    // Leyline Tyrant - Red mana doesn't empty
    if (cardName.includes("leyline tyrant") ||
        (oracleText.includes("red mana") && oracleText.includes("don't lose"))) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Leyline Tyrant",
        type: 'doesnt_empty',
        colors: ['red'],
      });
    }
    
    // Kruphix, God of Horizons / Horizon Stone - Unspent mana becomes colorless
    if (cardName.includes("kruphix") || cardName.includes("horizon stone") ||
        oracleText.includes("mana becomes colorless instead")) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Horizon Stone",
        type: 'becomes_colorless',
      });
    }
    
    // Upwelling / Eladamri's Vineyard style - All mana doesn't empty
    if (cardName.includes("upwelling") ||
        (oracleText.includes("mana pools") && oracleText.includes("don't empty"))) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Upwelling",
        type: 'all_doesnt_empty',
      });
    }
    
    // Omnath, Locus of the Roil / Omnath, Locus of Creation - Landfall mana
    // (These add mana that doesn't need special retention handling)
    
    // Savage Ventmaw - Adds mana that doesn't empty until end of turn
    if (cardName.includes("savage ventmaw")) {
      // This is handled by combat triggers, not retention effects
    }
    
    // Grand Warlord Radha - Adds mana that doesn't empty until end of turn
    if (cardName.includes("grand warlord radha")) {
      // This is handled by attack triggers, not retention effects
    }
  }
  
  return effects;
}

/**
 * Add mana to persistent pool (doesn't empty until end of turn).
 * Sources: Grand Warlord Radha, Savage Ventmaw, Neheb, Omnath, etc.
 */
export function addPersistentMana(
  gameState: any,
  playerId: string,
  mana: { white?: number; blue?: number; black?: number; red?: number; green?: number; colorless?: number }
): void {
  const pool = getOrInitPersistentManaPool(gameState, playerId);
  for (const [color, amount] of Object.entries(mana)) {
    if (amount && amount > 0) {
      pool[color] = (pool[color] || 0) + amount;
    }
  }
}

/**
 * Process mana pool emptying at phase/step end, respecting retention effects.
 * 
 * This is the main function to call when steps/phases end.
 */
export function processManaDrain(gameState: any, playerId: string): {
  drained: Record<string, number>;
  retained: Record<string, number>;
  converted: Record<string, number>; // Colored mana that became colorless
} {
  const pool = getOrInitManaPool(gameState, playerId);
  const effects = detectManaRetentionEffects(gameState, playerId);
  
  const result = {
    drained: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    retained: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    converted: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  
  // Check for "all mana doesn't empty" effect
  const hasUpwellingEffect = effects.some(e => e.type === 'all_doesnt_empty');
  if (hasUpwellingEffect) {
    // All mana is retained
    for (const color of Object.keys(pool)) {
      result.retained[color] = pool[color] || 0;
    }
    return result;
  }
  
  // Check for "becomes colorless" effect (Kruphix, Horizon Stone)
  const hasBecomesColorless = effects.some(e => e.type === 'becomes_colorless');
  
  // Check which colors don't empty
  const colorsDoNotEmpty = new Set<string>();
  for (const effect of effects) {
    if (effect.type === 'doesnt_empty' && effect.colors) {
      for (const color of effect.colors) {
        colorsDoNotEmpty.add(color);
      }
    }
  }
  
  // Process each color
  for (const color of ['white', 'blue', 'black', 'red', 'green', 'colorless']) {
    const amount = pool[color] || 0;
    if (amount === 0) continue;
    
    if (colorsDoNotEmpty.has(color)) {
      // This color doesn't empty
      result.retained[color] = amount;
    } else if (hasBecomesColorless && color !== 'colorless') {
      // Colored mana becomes colorless
      result.converted[color] = amount;
      pool.colorless = (pool.colorless || 0) + amount;
      pool[color] = 0;
      result.retained.colorless = (result.retained.colorless || 0) + amount;
    } else {
      // Mana empties normally
      result.drained[color] = amount;
      pool[color] = 0;
    }
  }
  
  return result;
}

/**
 * Clear normal mana pool (at phase/step end).
 * Use processManaDrain() instead for proper handling of retention effects.
 */
export function clearManaPool(gameState: any, playerId: string): void {
  if (gameState.manaPool?.[playerId]) {
    gameState.manaPool[playerId] = {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };
  }
}

/**
 * Clear persistent mana pool (at end of turn only).
 */
export function clearPersistentManaPool(gameState: any, playerId: string): void {
  if (gameState.persistentManaPool?.[playerId]) {
    gameState.persistentManaPool[playerId] = {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };
  }
}

/**
 * Clear all mana pools at end of turn.
 */
export function clearAllManaPools(gameState: any, playerId: string): void {
  clearManaPool(gameState, playerId);
  clearPersistentManaPool(gameState, playerId);
}

/**
 * Get total available mana (normal pool + persistent pool).
 */
export function getTotalManaPool(
  gameState: any,
  playerId: string
): Record<string, number> {
  const normal = getOrInitManaPool(gameState, playerId);
  const persistent = getOrInitPersistentManaPool(gameState, playerId);
  
  return {
    white: (normal.white || 0) + (persistent.white || 0),
    blue: (normal.blue || 0) + (persistent.blue || 0),
    black: (normal.black || 0) + (persistent.black || 0),
    red: (normal.red || 0) + (persistent.red || 0),
    green: (normal.green || 0) + (persistent.green || 0),
    colorless: (normal.colorless || 0) + (persistent.colorless || 0),
  };
}

/**
 * Calculates the total available mana by combining existing pool with new payment.
 * Returns the combined pool in the same format as the mana pool (using color names as keys).
 */
export function calculateTotalAvailableMana(
  existingPool: Record<string, number>,
  newPayment: Array<{ mana: string; count?: number }> | undefined
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
  
  // Add new payment - use count field for multi-mana sources like Sol Ring
  if (newPayment && newPayment.length > 0) {
    for (const p of newPayment) {
      const colorKey = MANA_COLOR_NAMES[p.mana];
      if (colorKey) {
        // Use count if provided (e.g., Sol Ring produces 2), default to 1
        const manaAmount = p.count ?? 1;
        total[colorKey] = (total[colorKey] || 0) + manaAmount;
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

/**
 * Mana production info for a permanent
 */
export interface ManaProductionInfo {
  /** Base colors this permanent can produce */
  colors: string[];
  /** Base amount of mana produced per tap (before multipliers) */
  baseAmount: number;
  /** Whether the amount is dynamic (depends on game state) */
  isDynamic: boolean;
  /** Description of how mana is calculated (for dynamic sources) */
  dynamicDescription?: string;
  /** Extra mana from enchantments/effects on this permanent */
  bonusMana: { color: string; amount: number }[];
  /** Multiplier from global effects (Mana Reflection, Nyxbloom Ancient) */
  multiplier: number;
  /** Total mana produced (baseAmount * multiplier + bonuses) */
  totalAmount: number;
}

/**
 * Calculate the actual mana produced when a permanent is tapped.
 * 
 * This considers:
 * - Fixed multi-mana (Sol Ring: {C}{C})
 * - Dynamic mana (Gaea's Cradle: {G} per creature)
 * - Land enchantments (Wild Growth, Utopia Sprawl, Overgrowth)
 * - Global effects (Caged Sun, Mana Reflection, Mirari's Wake, Nyxbloom Ancient)
 * 
 * @param gameState - Current game state
 * @param permanent - The permanent being tapped for mana
 * @param playerId - Controller of the permanent
 * @param chosenColor - For "any color" abilities, which color was chosen
 * @returns ManaProductionInfo with calculated mana amounts
 */
export function calculateManaProduction(
  gameState: any,
  permanent: any,
  playerId: string,
  chosenColor?: string
): ManaProductionInfo {
  const card = permanent?.card || {};
  const oracleText = (card.oracle_text || '').toLowerCase();
  const typeLine = (card.type_line || '').toLowerCase();
  const cardName = (card.name || '').toLowerCase();
  const battlefield = gameState?.battlefield || [];
  
  const result: ManaProductionInfo = {
    colors: [],
    baseAmount: 1,
    isDynamic: false,
    bonusMana: [],
    multiplier: 1,
    totalAmount: 1,
  };
  
  // ===== STEP 1: Determine base mana production from the card itself =====
  
  // Check for fixed multi-mana patterns: "Add {C}{C}" (Sol Ring), "Add {G}{G}" (Overgrowth)
  const fixedManaMatch = oracleText.match(/add\s+((?:\{[wubrgc]\})+)/gi);
  if (fixedManaMatch) {
    for (const match of fixedManaMatch) {
      const symbols = match.match(/\{[wubrgc]\}/gi) || [];
      if (symbols.length > 0) {
        result.baseAmount = symbols.length;
        // Get the color(s)
        for (const sym of symbols) {
          const color = sym.replace(/[{}]/g, '').toUpperCase();
          if (!result.colors.includes(color)) {
            result.colors.push(color);
          }
        }
      }
    }
  }
  
  // Check for "any color" patterns
  if (oracleText.includes('any color') || oracleText.includes('mana of any color')) {
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor && result.colors.includes(chosenColor)) {
      result.colors = [chosenColor];
    }
  }
  
  // Handle basic land types
  if (typeLine.includes('plains') && !result.colors.includes('W')) result.colors.push('W');
  if (typeLine.includes('island') && !result.colors.includes('U')) result.colors.push('U');
  if (typeLine.includes('swamp') && !result.colors.includes('B')) result.colors.push('B');
  if (typeLine.includes('mountain') && !result.colors.includes('R')) result.colors.push('R');
  if (typeLine.includes('forest') && !result.colors.includes('G')) result.colors.push('G');
  
  // ===== STEP 2: Check for dynamic mana production =====
  
  // Gaea's Cradle - "Add {G} for each creature you control"
  if (cardName.includes("gaea's cradle") || 
      (oracleText.includes('add {g}') && oracleText.includes('for each creature'))) {
    const creatureCount = battlefield.filter((p: any) => 
      p && p.controller === playerId && 
      (p.card?.type_line || '').toLowerCase().includes('creature')
    ).length;
    result.isDynamic = true;
    result.baseAmount = creatureCount;
    result.dynamicDescription = `{G} for each creature you control (${creatureCount})`;
    result.colors = ['G'];
  }
  
  // Serra's Sanctum - "Add {W} for each enchantment you control"
  if (cardName.includes("serra's sanctum") ||
      (oracleText.includes('add {w}') && oracleText.includes('for each enchantment'))) {
    const enchantmentCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('enchantment')
    ).length;
    result.isDynamic = true;
    result.baseAmount = enchantmentCount;
    result.dynamicDescription = `{W} for each enchantment you control (${enchantmentCount})`;
    result.colors = ['W'];
  }
  
  // Tolarian Academy - "Add {U} for each artifact you control"
  if (cardName.includes("tolarian academy") ||
      (oracleText.includes('add {u}') && oracleText.includes('for each artifact'))) {
    const artifactCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('artifact')
    ).length;
    result.isDynamic = true;
    result.baseAmount = artifactCount;
    result.dynamicDescription = `{U} for each artifact you control (${artifactCount})`;
    result.colors = ['U'];
  }
  
  // Three Tree City - Has two abilities:
  // 1. {T}: Add {C}
  // 2. {2}, {T}: Add mana equal to creatures of the chosen type
  // The chosen creature type is stored on the permanent
  if (cardName.includes("three tree city")) {
    // Get the chosen creature type from the permanent
    const chosenCreatureType = (permanent?.chosenCreatureType || '').toLowerCase();
    
    if (chosenCreatureType) {
      // Count creatures of the chosen type
      const creatureCount = battlefield.filter((p: any) => {
        if (!p || p.controller !== playerId) return false;
        const typeLine = (p.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) return false;
        // Check if the creature has the chosen type
        return typeLine.includes(chosenCreatureType);
      }).length;
      
      result.isDynamic = true;
      result.baseAmount = creatureCount;
      result.dynamicDescription = `Mana for each ${chosenCreatureType} you control (${creatureCount})`;
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      // No creature type chosen yet, just produces {C}
      result.baseAmount = 1;
      result.colors = ['C'];
    }
  }
  
  // Wirewood Channeler, Priest of Titania style - "Add {G} for each Elf"
  if (oracleText.includes('for each elf') || 
      (cardName.includes('priest of titania')) ||
      (cardName.includes('wirewood channeler'))) {
    const elfCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('elf')
    ).length;
    result.isDynamic = true;
    result.baseAmount = elfCount;
    result.dynamicDescription = `Mana for each Elf you control (${elfCount})`;
    if (cardName.includes('wirewood channeler')) {
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      result.colors = ['G'];
    }
  }
  
  // Everflowing Chalice - "Add {C} for each charge counter on Everflowing Chalice"
  if (cardName.includes('everflowing chalice') ||
      (oracleText.includes('for each charge counter') && oracleText.includes('add'))) {
    const chargeCounters = permanent?.counters?.charge || 0;
    result.isDynamic = true;
    result.baseAmount = chargeCounters;
    result.dynamicDescription = `{C} for each charge counter (${chargeCounters})`;
    result.colors = ['C'];
  }
  
  // Astral Cornucopia - "Add one mana of any color for each charge counter"
  if (cardName.includes('astral cornucopia') ||
      (oracleText.includes('for each charge counter') && oracleText.includes('any color'))) {
    const chargeCounters = permanent?.counters?.charge || 0;
    result.isDynamic = true;
    result.baseAmount = chargeCounters;
    result.dynamicDescription = `Mana for each charge counter (${chargeCounters})`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Gemstone Array - Based on charge counters (can remove to add mana)
  if (cardName.includes('gemstone array')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    if (chargeCounters > 0) {
      result.isDynamic = true;
      result.baseAmount = 1; // Removes one counter for one mana
      result.dynamicDescription = `Remove charge counter for mana (${chargeCounters} available)`;
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    }
  }
  
  // Empowered Autogenerator - "Add X mana of any one color, where X is the number of charge counters"
  if (cardName.includes('empowered autogenerator')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    result.isDynamic = true;
    result.baseAmount = chargeCounters;
    result.dynamicDescription = `Mana equal to charge counters (${chargeCounters})`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Nykthos, Shrine to Nyx - "Add X mana of any one color, where X is your devotion to that color"
  // Devotion = count of mana symbols of that color in mana costs of permanents you control
  if (cardName.includes('nykthos') || 
      (oracleText.includes('devotion') && oracleText.includes('add'))) {
    // Calculate devotion for the chosen color
    const devotionColor = chosenColor || 'W'; // Default to white if no color chosen
    let devotion = 0;
    
    for (const perm of battlefield) {
      if (perm && perm.controller === playerId) {
        const manaCost = (perm.card?.mana_cost || '').toUpperCase();
        // Count occurrences of the color symbol using pre-compiled pattern
        const pattern = DEVOTION_COLOR_PATTERNS[devotionColor];
        if (pattern) {
          const matches = manaCost.match(pattern) || [];
          devotion += matches.length;
        }
        
        // Also count hybrid mana that includes this color (e.g., {W/U} counts for both W and U)
        const hybridMatches = manaCost.match(/\{[WUBRG]\/[WUBRG]\}/gi) || [];
        for (const hybrid of hybridMatches) {
          if (hybrid.toUpperCase().includes(devotionColor)) {
            devotion += 1;
          }
        }
      }
    }
    
    result.isDynamic = true;
    result.baseAmount = devotion;
    result.dynamicDescription = `{${devotionColor}} for devotion (${devotion})`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Cabal Coffers - "Add {B} for each Swamp you control"
  if (cardName.includes('cabal coffers') ||
      (oracleText.includes('add {b}') && oracleText.includes('for each swamp'))) {
    const swampCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('swamp')
    ).length;
    result.isDynamic = true;
    result.baseAmount = swampCount;
    result.dynamicDescription = `{B} for each Swamp you control (${swampCount})`;
    result.colors = ['B'];
  }
  
  // Cabal Stronghold - Similar to Cabal Coffers but only basic Swamps
  if (cardName.includes('cabal stronghold')) {
    const basicSwampCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('basic') &&
      (p.card?.type_line || '').toLowerCase().includes('swamp')
    ).length;
    result.isDynamic = true;
    result.baseAmount = basicSwampCount;
    result.dynamicDescription = `{B} for each basic Swamp (${basicSwampCount})`;
    result.colors = ['B'];
  }
  
  // Nyx Lotus - "Add X mana of any one color, where X is your devotion to that color"
  if (cardName.includes('nyx lotus')) {
    const devotionColor = chosenColor || 'W';
    let devotion = 0;
    
    for (const perm of battlefield) {
      if (perm && perm.controller === playerId) {
        const manaCost = (perm.card?.mana_cost || '').toUpperCase();
        // Use pre-compiled pattern for devotion color matching
        const pattern = DEVOTION_COLOR_PATTERNS[devotionColor];
        if (pattern) {
          const matches = manaCost.match(pattern) || [];
          devotion += matches.length;
        }
        
        const hybridMatches = manaCost.match(/\{[WUBRG]\/[WUBRG]\}/gi) || [];
        for (const hybrid of hybridMatches) {
          if (hybrid.toUpperCase().includes(devotionColor)) {
            devotion += 1;
          }
        }
      }
    }
    
    result.isDynamic = true;
    result.baseAmount = devotion;
    result.dynamicDescription = `{${devotionColor}} for devotion (${devotion})`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // ===== STEP 3: Check for aura enchantments on this permanent (Wild Growth, etc.) =====
  
  // Find auras attached to this permanent
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId) continue;
    
    const permTypeLine = (perm.card?.type_line || '').toLowerCase();
    const permOracleText = (perm.card?.oracle_text || '').toLowerCase();
    const permName = (perm.card?.name || '').toLowerCase();
    
    // Check if this is an aura enchanting our permanent
    const isAura = permTypeLine.includes('enchantment') && permTypeLine.includes('aura');
    const isAttachedToUs = (perm as any).attachedTo === permanent.id || 
                           (perm as any).enchanting === permanent.id;
    
    if (isAura && isAttachedToUs) {
      // Wild Growth - "Whenever enchanted land is tapped for mana, add an additional {G}"
      if (permName.includes('wild growth') || 
          (permOracleText.includes('additional {g}') && permOracleText.includes('tapped for mana'))) {
        result.bonusMana.push({ color: 'G', amount: 1 });
      }
      
      // Fertile Ground - "Whenever enchanted land is tapped for mana, add an additional mana of any color"
      if (permName.includes('fertile ground') ||
          (permOracleText.includes('additional') && permOracleText.includes('any color'))) {
        result.bonusMana.push({ color: chosenColor || 'C', amount: 1 });
      }
      
      // Overgrowth - "Whenever enchanted land is tapped for mana, add {G}{G}"
      if (permName.includes('overgrowth') ||
          (permOracleText.includes('add {g}{g}') && permOracleText.includes('tapped for mana'))) {
        result.bonusMana.push({ color: 'G', amount: 2 });
      }
      
      // Utopia Sprawl - "Whenever enchanted Forest is tapped for mana, add one mana of the chosen color"
      if (permName.includes('utopia sprawl')) {
        const chosenAuraColor = (perm as any).chosenColor || chosenColor || 'G';
        result.bonusMana.push({ color: chosenAuraColor, amount: 1 });
      }
      
      // Dawn's Reflection - "Whenever enchanted land is tapped for mana, add two mana of any one color"
      if (permName.includes("dawn's reflection")) {
        result.bonusMana.push({ color: chosenColor || 'G', amount: 2 });
      }
      
      // Market Festival - "Whenever enchanted land is tapped for mana, add two mana of any one color"
      if (permName.includes('market festival')) {
        result.bonusMana.push({ color: chosenColor || 'G', amount: 2 });
      }
      
      // Weirding Wood - "Whenever enchanted land is tapped for mana, add an additional mana of any color"
      if (permName.includes('weirding wood')) {
        result.bonusMana.push({ color: chosenColor || 'G', amount: 1 });
      }
      
      // Trace of Abundance - "Whenever enchanted land is tapped for mana, add one mana of any color"
      if (permName.includes('trace of abundance')) {
        result.bonusMana.push({ color: chosenColor || 'G', amount: 1 });
      }
      
      // Sheltered Aerie - "Whenever enchanted land is tapped for mana, add one mana of any color"
      if (permName.includes('sheltered aerie')) {
        result.bonusMana.push({ color: chosenColor || 'G', amount: 1 });
      }
    }
  }
  
  // ===== STEP 4: Check for global mana-boosting effects =====
  
  const isLand = typeLine.includes('land');
  const cardColors = (card.colors || []).map((c: string) => c.toUpperCase());
  
  for (const perm of battlefield) {
    if (!perm) continue;
    
    const permOracleText = (perm.card?.oracle_text || '').toLowerCase();
    const permName = (perm.card?.name || '').toLowerCase();
    const permController = perm.controller;
    
    // Only apply effects from our own permanents or global effects
    const isOurs = permController === playerId;
    
    // Caged Sun - "Whenever a land you control is tapped for mana of the chosen color, add one additional mana of that color"
    if (permName.includes('caged sun') && isOurs && isLand) {
      const chosenSunColor = (perm as any).chosenColor || 'C';
      if (result.colors.includes(chosenSunColor) || (chosenColor && chosenSunColor === chosenColor)) {
        result.bonusMana.push({ color: chosenSunColor, amount: 1 });
      }
    }
    
    // Gauntlet of Power - "Whenever a basic land is tapped for mana of the chosen color, add one additional mana of that color"
    if (permName.includes('gauntlet of power') && isOurs && typeLine.includes('basic')) {
      const chosenGauntletColor = (perm as any).chosenColor || 'C';
      if (result.colors.includes(chosenGauntletColor) || (chosenColor && chosenGauntletColor === chosenColor)) {
        result.bonusMana.push({ color: chosenGauntletColor, amount: 1 });
      }
    }
    
    // Mirari's Wake - "Whenever you tap a land for mana, add one mana of any type that land produced"
    if (permName.includes("mirari's wake") && isOurs && isLand) {
      // Adds one of the same type
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Zendikar Resurgent - "Whenever you tap a land for mana, add one mana of any type that land produced"
    if (permName.includes('zendikar resurgent') && isOurs && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Mana Reflection - "If you tap a permanent for mana, it produces double"
    if (permName.includes('mana reflection') && isOurs) {
      result.multiplier *= 2;
    }
    
    // Nyxbloom Ancient - "If you tap a permanent for mana, it produces three times as much"
    if (permName.includes('nyxbloom ancient') && isOurs) {
      result.multiplier *= 3;
    }
    
    // Mana Flare - "Whenever a player taps a land for mana, that land produces an additional mana"
    if (permName.includes('mana flare') && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Dictate of Karametra - "Whenever a player taps a land for mana, that land produces an additional mana"
    if (permName.includes('dictate of karametra') && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Heartbeat of Spring - Same as Mana Flare
    if (permName.includes('heartbeat of spring') && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Vorinclex, Voice of Hunger - "Whenever you tap a land for mana, add one mana of any type that land could produce"
    if (permName.includes('vorinclex') && permName.includes('voice of hunger') && isOurs && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
  }
  
  // ===== STEP 5: Calculate total mana =====
  
  // Base amount * multiplier
  let total = result.baseAmount * result.multiplier;
  
  // Add bonus mana (bonuses are NOT multiplied in most cases, but for simplicity we add them after)
  for (const bonus of result.bonusMana) {
    total += bonus.amount;
  }
  
  result.totalAmount = Math.max(0, total);
  
  // If no colors determined, default to colorless
  if (result.colors.length === 0) {
    result.colors = ['C'];
  }
  
  return result;
}

/**
 * Emit an event to a specific player's connected sockets.
 * Iterates through all connected sockets and emits to those with matching playerId.
 */
export function emitToPlayer(
  io: Server,
  playerId: string,
  event: string,
  payload: any
): void {
  try {
    for (const socket of io.sockets.sockets.values()) {
      try {
        if ((socket.data as any)?.playerId === playerId && !(socket.data as any)?.spectator) {
          socket.emit(event, payload);
        }
      } catch {
        // ignore per-socket errors
      }
    }
  } catch (err) {
    console.warn(`[util] emitToPlayer failed for ${event}:`, err);
  }
}