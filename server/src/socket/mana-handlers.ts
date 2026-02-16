/**
 * mana-handlers.ts
 * 
 * Socket handlers for mana pool management operations.
 * Extracted from interaction.ts for better modularity (PR 352 follow-up).
 * 
 * This module contains handlers for:
 * - Adding mana to pool (regular and restricted)
 * - Removing mana from pool
 * - Setting "mana doesn't empty" effects (Horizon Stone, Kruphix, etc.)
 * - Removing "mana doesn't empty" effects
 */

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName, broadcastManaPoolUpdate } from "./util.js";

/**
 * Register all mana-related socket handlers
 */
export function registerManaHandlers(io: Server, socket: Socket) {
  /**
   * Add mana to a player's mana pool
   * Used for manual adjustments or card effects that add restricted mana
   */
  socket.on(
    "addManaToPool",
    (payload?: {
      gameId?: unknown;
      color?: unknown;
      amount?: unknown;
      restriction?: unknown;
      restrictedTo?: unknown;
      sourceId?: unknown;
      sourceName?: unknown;
    }) => {
    const gameId = payload?.gameId;
    const color = payload?.color;
    const amount = payload?.amount;
    const restriction = payload?.restriction;
    const restrictedTo = payload?.restrictedTo;
    const sourceId = payload?.sourceId;
    const sourceName = payload?.sourceName;
    const pid = socket.data.playerId as string | undefined;
    if (!pid || (socket.data as any)?.spectator || (socket.data as any)?.isSpectator) return;

    if (!gameId || typeof gameId !== 'string') return;

    if (
      typeof amount !== 'number' ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !color ||
      (color !== 'white' && color !== 'blue' && color !== 'black' && color !== 'red' && color !== 'green' && color !== 'colorless')
    ) {
      socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Invalid mana payload.' });
      return;
    }
    const manaColor = color as 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
    const manaAmount = amount as number;

    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    const players = (game.state as any)?.players;
    const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
    const seatIsSpectator = !!(seated && ((seated as any).spectator || (seated as any).isSpectator));
    if (!seated || seatIsSpectator) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
      return;
    }

    // Initialize mana pool if needed
    game.state.manaPool = game.state.manaPool || {};
    game.state.manaPool[pid] = game.state.manaPool[pid] || {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };

    if (restriction) {
      // Add restricted mana
      const pool = game.state.manaPool[pid] as any;
      pool.restricted = pool.restricted || [];
      pool.restricted.push({
        type: color,
        amount: manaAmount,
        restriction,
        restrictedTo,
        sourceId,
        sourceName,
      });
    } else {
      // Add regular mana
      (game.state.manaPool[pid] as any)[manaColor] = 
        ((game.state.manaPool[pid] as any)[manaColor] || 0) + manaAmount;
    }

    // Bump game sequence
    if (typeof (game as any).bumpSeq === "function") {
      (game as any).bumpSeq();
    }

    // Log the mana addition
    const restrictionText = restriction ? ` (${restriction})` : '';
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} added ${manaAmount} ${manaColor} mana to their pool${restrictionText}.`,
      ts: Date.now(),
    });

    // Emit mana pool update
    broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, 'Added mana', game);
    broadcastGame(io, game, gameId);
    },
  );

  /**
   * Remove mana from a player's mana pool
   * Used for manual adjustments or payment verification
   */
  socket.on(
    "removeManaFromPool",
    (payload?: {
      gameId?: unknown;
      color?: unknown;
      amount?: unknown;
      restrictedIndex?: unknown;
    }) => {
    const gameId = payload?.gameId;
    const color = payload?.color;
    const amount = payload?.amount;
    const restrictedIndex = payload?.restrictedIndex;
    const pid = socket.data.playerId as string | undefined;
    if (!pid || (socket.data as any)?.spectator || (socket.data as any)?.isSpectator) return;

    if (!gameId || typeof gameId !== 'string') return;

    if (
      typeof amount !== 'number' ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !color ||
      (color !== 'white' && color !== 'blue' && color !== 'black' && color !== 'red' && color !== 'green' && color !== 'colorless')
    ) {
      socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Invalid mana payload.' });
      return;
    }

    if (restrictedIndex !== undefined && (typeof restrictedIndex !== 'number' || !Number.isInteger(restrictedIndex) || restrictedIndex < 0)) {
      socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Invalid restricted mana index.' });
      return;
    }
    const manaColor = color as 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
    const manaAmount = amount as number;
    const restrictedIndexValue = restrictedIndex as number | undefined;

    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    const players = (game.state as any)?.players;
    const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
    const seatIsSpectator = !!(seated && ((seated as any).spectator || (seated as any).isSpectator));
    if (!seated || seatIsSpectator) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
      return;
    }

    const pool = game.state.manaPool?.[pid] as any;
    if (!pool) {
      socket.emit("error", { code: "INVALID_ACTION", message: "No mana pool to remove from" });
      return;
    }

    if (restrictedIndexValue !== undefined) {
      // Remove from restricted mana
      if (!pool.restricted || restrictedIndexValue >= pool.restricted.length) {
        socket.emit("error", { code: "INVALID_ACTION", message: "Invalid restricted mana index" });
        return;
      }
      const entry = pool.restricted[restrictedIndexValue];
      if (entry.amount < manaAmount) {
        socket.emit("error", { code: "INVALID_ACTION", message: "Not enough restricted mana" });
        return;
      }
      if (entry.amount === manaAmount) {
        pool.restricted.splice(restrictedIndexValue, 1);
        if (pool.restricted.length === 0) {
          delete pool.restricted;
        }
      } else {
        entry.amount -= manaAmount;
      }
    } else {
      // Remove from regular mana
      if ((pool[manaColor] || 0) < manaAmount) {
        socket.emit("error", { code: "INVALID_ACTION", message: `Not enough ${manaColor} mana` });
        return;
      }
      pool[manaColor] = (pool[manaColor] || 0) - manaAmount;
    }

    // Bump game sequence
    if (typeof (game as any).bumpSeq === "function") { (game as any).bumpSeq(); }

    // Log the mana removal
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} removed ${manaAmount} ${manaColor} mana from their pool.`,
      ts: Date.now(),
    });

    // Emit mana pool update
    broadcastManaPoolUpdate(io, gameId, pid, pool, 'Removed mana', game);
    broadcastGame(io, game, gameId);
    },
  );

  /**
   * Set mana pool "doesn't empty" effect
   * Used by cards like Horizon Stone, Omnath Locus of Mana, Kruphix
   */
  socket.on(
    "setManaPoolDoesNotEmpty",
    (payload?: {
      gameId?: unknown;
      sourceId?: unknown;
      sourceName?: unknown;
      convertsTo?: unknown;
      convertsToColorless?: unknown;
    }) => {
    const gameId = payload?.gameId;
    const sourceId = payload?.sourceId;
    const sourceName = payload?.sourceName;
    const convertsTo = payload?.convertsTo;
    const convertsToColorless = payload?.convertsToColorless;
    const pid = socket.data.playerId as string | undefined;
    if (!pid || (socket.data as any)?.spectator || (socket.data as any)?.isSpectator) return;

    if (!gameId || typeof gameId !== 'string') return;

    if (typeof sourceId !== 'string' || sourceId.length === 0 || typeof sourceName !== 'string' || sourceName.length === 0) {
      socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Invalid source for mana retention.' });
      return;
    }

    if (
      convertsTo !== undefined &&
      convertsTo !== 'white' &&
      convertsTo !== 'blue' &&
      convertsTo !== 'black' &&
      convertsTo !== 'red' &&
      convertsTo !== 'green' &&
      convertsTo !== 'colorless'
    ) {
      socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Invalid convertsTo value.' });
      return;
    }
    if (convertsToColorless !== undefined && typeof convertsToColorless !== 'boolean') {
      socket.emit?.('error', { code: 'INVALID_PAYLOAD', message: 'Invalid convertsToColorless value.' });
      return;
    }
    const sourceIdValue = sourceId as string;
    const sourceNameValue = sourceName as string;
    const convertsToValue = convertsTo as ('white' | 'blue' | 'black' | 'red' | 'green' | 'colorless' | undefined);
    const convertsToColorlessValue = convertsToColorless as (boolean | undefined);

    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    const players = (game.state as any)?.players;
    const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
    const seatIsSpectator = !!(seated && ((seated as any).spectator || (seated as any).isSpectator));
    if (!seated || seatIsSpectator) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
      return;
    }

    // Initialize mana pool if needed
    game.state.manaPool = game.state.manaPool || {};
    game.state.manaPool[pid] = game.state.manaPool[pid] || {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };

    const pool = game.state.manaPool[pid] as any;
    pool.doesNotEmpty = true;
    
    // Support both new convertsTo and deprecated convertsToColorless
    if (convertsToValue) {
      pool.convertsTo = convertsToValue;
    } else if (convertsToColorlessValue) {
      pool.convertsTo = 'colorless';
      pool.convertsToColorless = true; // Keep for backwards compatibility
    }
    
    pool.noEmptySourceIds = pool.noEmptySourceIds || [];
    if (!pool.noEmptySourceIds.includes(sourceIdValue)) {
      pool.noEmptySourceIds.push(sourceIdValue);
    }

    // Bump game sequence
    if (typeof (game as any).bumpSeq === "function") { (game as any).bumpSeq(); }

    // Log the effect
    const targetColor = convertsToValue || (convertsToColorlessValue ? 'colorless' : null);
    const effectText = targetColor 
      ? `Mana converts to ${targetColor} instead of emptying (${sourceNameValue})`
      : `Mana doesn't empty from pool (${sourceNameValue})`;
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)}: ${effectText}`,
      ts: Date.now(),
    });

    // Emit mana pool update
    broadcastManaPoolUpdate(io, gameId, pid, pool, `Doesn't empty (${sourceNameValue})`, game);
    broadcastGame(io, game, gameId);
    },
  );

  /**
   * Remove mana pool "doesn't empty" effect
   * Called when the source permanent leaves the battlefield
   */
  socket.on(
    "removeManaPoolDoesNotEmpty",
    (payload?: { gameId?: unknown; sourceId?: unknown }) => {
    const gameId = payload?.gameId;
    const sourceId = payload?.sourceId;
    const pid = socket.data.playerId as string | undefined;
    if (!pid || (socket.data as any)?.spectator || (socket.data as any)?.isSpectator) return;

    if (!gameId || typeof gameId !== 'string') return;

    if (typeof sourceId !== 'string' || sourceId.length === 0) return;
    const sourceIdValue = sourceId;

    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    const players = (game.state as any)?.players;
    const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
    const seatIsSpectator = !!(seated && ((seated as any).spectator || (seated as any).isSpectator));
    if (!seated || seatIsSpectator) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
      return;
    }

    const pool = game.state.manaPool?.[pid] as any;
    if (!pool || !pool.noEmptySourceIds) return;

    pool.noEmptySourceIds = pool.noEmptySourceIds.filter((id: string) => id !== sourceIdValue);

    if (pool.noEmptySourceIds.length === 0) {
      delete pool.doesNotEmpty;
      delete pool.convertsToColorless;
      delete pool.noEmptySourceIds;
    }

    // Bump game sequence
    if (typeof (game as any).bumpSeq === "function") { (game as any).bumpSeq(); }

    broadcastGame(io, game, gameId);
    },
  );
}
