import { games, priorityTimers, PRIORITY_TIMEOUT_MS } from "./socket";
import { appendEvent } from "../db";
import { Server } from "socket.io";
import type { InMemoryGame } from "./state/gameState";

/**
 * Ensures that the specified game exists in memory, otherwise throws an error.
 */
export function ensureGame(gameId: string): InMemoryGame {
  const game = games.get(gameId);
  if (!game) {
    throw new Error(`Game ${gameId} not found.`);
  }
  return game;
}

/**
 * Broadcasts the full game state to all connected participants using the Socket.IO server.
 */
export function broadcastGame(io: Server, game: InMemoryGame, gameId: string) {
  const participants = game.participants();
  for (const { socketId, playerId, spectator } of participants) {
    const view = game.viewFor(playerId, Boolean(spectator));
    io.to(socketId).emit("state", { gameId, view, seq: game.seq });
  }
}

/**
 * Appends a game event to both the database and the in-memory game instance.
 */
export function appendGameEvent(
  game: InMemoryGame,
  gameId: string,
  type: string,
  payload: Record<string, any> = {}
) {
  game.applyEvent({ type, ...payload });
  appendEvent(gameId, game.seq, type, payload);
}

/**
 * Clears and cancels the priority timeout timer for a specific game.
 */
export function clearPriorityTimer(gameId: string) {
  const timer = priorityTimers.get(gameId);
  if (timer) {
    clearTimeout(timer);
    priorityTimers.delete(gameId);
  }
}

/**
 * Schedules a priority timeout for a specific game, auto-passing priority after a timeout.
 */
export function schedulePriorityTimeout(
  io: Server,
  game: InMemoryGame,
  gameId: string
) {
  // Always clear any existing timer first
  clearPriorityTimer(gameId);

  // Only schedule when a priority window is active
  if (!game.state.active || !game.state.priority) return;

  // Determine count of active (non-skipped) players
  const activePlayers = game.state.players.filter((p) => !p.inactive);
  const activeCount = activePlayers.length;

  // Single-player: immediately auto-pass only when the stack is non-empty to progress resolutions.
  if (activeCount === 1) {
    if (game.state.stack.length === 0) return;
    priorityTimers.set(
      gameId,
      setTimeout(() => {
        doAutoPass(io, game, gameId, "auto-pass (single player)");
      }, 0)
    );
    return;
  }

  // Multi-player: schedule a 30s timeout if state remains unchanged
  const startSeq = game.seq;
  const startPriority = game.state.priority;
  const startStackDepth = game.state.stack.length;

  const timeout = setTimeout(() => {
    priorityTimers.delete(gameId);

    // Re-validate conditions before auto-pass
    const g = games.get(gameId);
    if (!g || !g.state.active) return;
    if (g.seq !== startSeq) return; // state changed, reschedule elsewhere
    if (g.state.priority !== startPriority) return; // priority moved
    if (g.state.stack.length !== startStackDepth) return; // stack changed

    doAutoPass(io, g, gameId, "auto-pass (30s timeout)");
  }, PRIORITY_TIMEOUT_MS);

  priorityTimers.set(gameId, timeout);
}

/**
 * Executes an automatic priority pass for a player after a timeout.
 */
function doAutoPass(
  io: Server,
  game: InMemoryGame,
  gameId: string,
  reason: string
) {
  const playerId = game.state.priority;
  if (!playerId) return;

  const { changed, resolvedNow } = game.passPriority(playerId);
  if (!changed) return;

  appendGameEvent(game, gameId, "passPriority", { by: playerId });

  if (resolvedNow) {
    appendGameEvent(game, gameId, "resolveTopOfStack");

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: "Top of stack resolved automatically.",
      ts: Date.now(),
    });
  }

  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `Priority passed automatically (${reason}).`,
    ts: Date.now(),
  });

  broadcastGame(io, game, gameId);
  io.to(gameId).emit("priority", { gameId, player: game.state.priority });

  // Schedule next priority window (if any)
  schedulePriorityTimeout(io, game, gameId);
}