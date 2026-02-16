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
      gameId?: string;
      color?: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
      amount?: number;
      restriction?: string;
      restrictedTo?: string;
      sourceId?: string;
      sourceName?: string;
    }) => {
      const { gameId, color, amount, restriction, restrictedTo, sourceId, sourceName } = payload || ({} as any);
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
        amount,
        restriction,
        restrictedTo,
        sourceId,
        sourceName,
      });
    } else {
      // Add regular mana
      (game.state.manaPool[pid] as any)[color] = 
        ((game.state.manaPool[pid] as any)[color] || 0) + amount;
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
      message: `${getPlayerName(game, pid)} added ${amount} ${color} mana to their pool${restrictionText}.`,
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
      gameId?: string;
      color?: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
      amount?: number;
      restrictedIndex?: number;
    }) => {
      const { gameId, color, amount, restrictedIndex } = payload || ({} as any);
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

    if (restrictedIndex !== undefined) {
      // Remove from restricted mana
      if (!pool.restricted || restrictedIndex >= pool.restricted.length) {
        socket.emit("error", { code: "INVALID_ACTION", message: "Invalid restricted mana index" });
        return;
      }
      const entry = pool.restricted[restrictedIndex];
      if (entry.amount < amount) {
        socket.emit("error", { code: "INVALID_ACTION", message: "Not enough restricted mana" });
        return;
      }
      if (entry.amount === amount) {
        pool.restricted.splice(restrictedIndex, 1);
        if (pool.restricted.length === 0) {
          delete pool.restricted;
        }
      } else {
        entry.amount -= amount;
      }
    } else {
      // Remove from regular mana
      if ((pool[color] || 0) < amount) {
        socket.emit("error", { code: "INVALID_ACTION", message: `Not enough ${color} mana` });
        return;
      }
      pool[color] = (pool[color] || 0) - amount;
    }

    // Bump game sequence
    if (typeof (game as any).bumpSeq === "function") { (game as any).bumpSeq(); }

    // Log the mana removal
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} removed ${amount} ${color} mana from their pool.`,
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
      gameId?: string;
      sourceId?: string;
      sourceName?: string;
      convertsTo?: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
      convertsToColorless?: boolean;
    }) => {
      const { gameId, sourceId, sourceName, convertsTo, convertsToColorless } = payload || ({} as any);
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
    if (convertsTo) {
      pool.convertsTo = convertsTo;
    } else if (convertsToColorless) {
      pool.convertsTo = 'colorless';
      pool.convertsToColorless = true; // Keep for backwards compatibility
    }
    
    pool.noEmptySourceIds = pool.noEmptySourceIds || [];
    if (!pool.noEmptySourceIds.includes(sourceId)) {
      pool.noEmptySourceIds.push(sourceId);
    }

    // Bump game sequence
    if (typeof (game as any).bumpSeq === "function") { (game as any).bumpSeq(); }

    // Log the effect
    const targetColor = convertsTo || (convertsToColorless ? 'colorless' : null);
    const effectText = targetColor 
      ? `Mana converts to ${targetColor} instead of emptying (${sourceName})`
      : `Mana doesn't empty from pool (${sourceName})`;
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)}: ${effectText}`,
      ts: Date.now(),
    });

    // Emit mana pool update
    broadcastManaPoolUpdate(io, gameId, pid, pool, `Doesn't empty (${sourceName})`, game);
    broadcastGame(io, game, gameId);
    },
  );

  /**
   * Remove mana pool "doesn't empty" effect
   * Called when the source permanent leaves the battlefield
   */
  socket.on(
    "removeManaPoolDoesNotEmpty",
    (payload?: { gameId?: string; sourceId?: string }) => {
      const { gameId, sourceId } = payload || ({} as any);
    const pid = socket.data.playerId as string | undefined;
    if (!pid || (socket.data as any)?.spectator || (socket.data as any)?.isSpectator) return;

    if (!gameId || typeof gameId !== 'string') return;

    if (typeof sourceId !== 'string' || sourceId.length === 0) return;

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

    pool.noEmptySourceIds = pool.noEmptySourceIds.filter((id: string) => id !== sourceId);

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
