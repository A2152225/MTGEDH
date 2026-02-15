import type { Server, Socket } from "socket.io";
import { ensureGame, getPlayerName } from "./util";
import { debug, debugWarn, debugError } from "../utils/debug.js";

/**
 * Roll a die with the specified number of sides.
 * @param sides Number of sides on the die
 * @returns A random number from 1 to sides (inclusive)
 */
function rollDie(sides: number): number {
  if (sides < 2) sides = 2;
  if (sides > 1000) sides = 1000; // Reasonable upper limit
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Flip a coin.
 * @returns 'heads' or 'tails'
 */
function flipCoin(): 'heads' | 'tails' {
  return Math.random() < 0.5 ? 'heads' : 'tails';
}

/**
 * Register socket handlers for randomness events (dice rolls, coin flips).
 * These are used for resolving game mechanics that require randomness.
 */
export function registerRandomnessHandlers(io: Server, socket: Socket) {
  /**
   * Handle die roll requests.
   * Broadcasts the result to all players in the game.
   */
  socket.on("rollDie", ({ gameId, sides }: { gameId: string; sides: number }) => {
    try {
      if (!gameId || typeof gameId !== 'string') return;

      if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
        socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
        return;
      }

      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as string | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", { code: "ROLL_DIE_ERROR", message: "Game not found or player not identified" });
        return;
      }

      const players = (game.state as any)?.players;
      const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === playerId) : undefined;
      const seatIsSpectator = !!(seated && ((seated as any).spectator || (seated as any).isSpectator));
      const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
      if (!seated || seatIsSpectator || socketIsSpectator) {
        socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
        return;
      }
      
      // Validate sides
      if (!sides || sides < 2) {
        sides = 6; // Default to d6
      }
      if (sides > 1000) {
        sides = 1000; // Cap at d1000
      }
      
      const result = rollDie(sides);
      const playerName = getPlayerName(game, playerId);
      const timestamp = Date.now();

      // Persist last die roll for rules that need to query it later.
      // Keep both a global last roll and a per-player last roll for "you rolled ..." templates.
      try {
        const stateAny = game.state as any;
        stateAny.lastDieRoll = { playerId, sides, result, timestamp };
        stateAny.lastDieRollByPlayer = stateAny.lastDieRollByPlayer || {};
        stateAny.lastDieRollByPlayer[playerId] = { sides, result, timestamp };
        stateAny.dieRollsThisTurn = stateAny.dieRollsThisTurn || {};
        stateAny.dieRollsThisTurn[playerId] = Array.isArray(stateAny.dieRollsThisTurn[playerId]) ? stateAny.dieRollsThisTurn[playerId] : [];
        stateAny.dieRollsThisTurn[playerId].push({ sides, result, timestamp });
      } catch {
        // Best-effort only; do not break die roll flow.
      }
      
      debug(2, `[randomness] ${playerName} rolled d${sides}: ${result}`);
      
      // Broadcast the result to all players
      io.to(gameId).emit("dieRollResult", {
        gameId,
        playerId,
        playerName,
        sides,
        result,
        timestamp,
      });
      
      // Also send as a chat message for game log
      io.to(gameId).emit("chat", {
        id: `m_${timestamp}`,
        gameId,
        from: "system",
        message: `${playerName} rolled a d${sides}: ${result}`,
        ts: timestamp,
      });
      
    } catch (err: any) {
      debugError(1, `rollDie error for game ${gameId}:`, err);
      socket.emit("error", { code: "ROLL_DIE_ERROR", message: err?.message ?? String(err) });
    }
  });
  
  /**
   * Handle coin flip requests.
   * Broadcasts the result to all players in the game.
   */
  socket.on("flipCoin", ({ gameId }: { gameId: string }) => {
    try {
      if (!gameId || typeof gameId !== 'string') return;

      if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
        socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
        return;
      }

      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as string | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", { code: "FLIP_COIN_ERROR", message: "Game not found or player not identified" });
        return;
      }

      const players = (game.state as any)?.players;
      const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === playerId) : undefined;
      const seatIsSpectator = !!(seated && ((seated as any).spectator || (seated as any).isSpectator));
      const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
      if (!seated || seatIsSpectator || socketIsSpectator) {
        socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' });
        return;
      }
      
      const result = flipCoin();
      const playerName = getPlayerName(game, playerId);
      const timestamp = Date.now();
      
      debug(2, `[randomness] ${playerName} flipped a coin: ${result}`);
      
      // Broadcast the result to all players
      io.to(gameId).emit("coinFlipResult", {
        gameId,
        playerId,
        playerName,
        result,
        timestamp,
      });
      
      // Also send as a chat message for game log
      io.to(gameId).emit("chat", {
        id: `m_${timestamp}`,
        gameId,
        from: "system",
        message: `${playerName} flipped a coin: ${result.toUpperCase()}`,
        ts: timestamp,
      });
      
    } catch (err: any) {
      debugError(1, `flipCoin error for game ${gameId}:`, err);
      socket.emit("error", { code: "FLIP_COIN_ERROR", message: err?.message ?? String(err) });
    }
  });
}

