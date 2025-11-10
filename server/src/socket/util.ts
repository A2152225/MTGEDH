import { Server } from "socket.io";
import { games, priorityTimers, PRIORITY_TIMEOUT_MS } from "./socket";
import { appendEvent, createGameIfNotExists, getEvents } from "../db";
import { createInitialGameState } from "../state";
import type { InMemoryGame } from "../state/gameState";

/**
 * Ensures that the specified game exists in both database and memory, creating it if necessary.
 */
export function ensureGame(gameId: string): InMemoryGame {
  let game = games.get(gameId);

  if (!game) {
    // Create an initial game state
    game = createInitialGameState(gameId);

    // Ensure it exists in the database
    createGameIfNotExists(gameId, game.state.format, game.state.startingLife);

    // Replay persisted events to reconstruct state
    const persistedEvents = getEvents(gameId);
    const replayEvents = persistedEvents.map((event) => ({
      type: event.type,
      ...(event.payload || {}),
    }));
    game.replay(replayEvents);

    // Register the reconstructed game in memory
    games.set(gameId, game);
  }

  return game;
}

/**
 * Broadcasts the full state of a game to all participants.
 */
export function broadcastGame(io: Server, game: InMemoryGame, gameId: string) {
  const participants = game.participants();
  for (const { socketId, playerId, spectator } of participants) {
    const view = game.viewFor(playerId, spectator);
    io.to(socketId).emit("state", { gameId, view, seq: game.seq });
  }
}

/**
 * Appends a game event (both in-memory and persisted to the DB).
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
 */
export function schedulePriorityTimeout(
  io: Server,
  game: InMemoryGame,
  gameId: string
) {
  clearPriorityTimer(gameId);

  if (!game.state.active || !game.state.priority) return;

  const activePlayers = game.state.players.filter((p) => !p.inactive);
  if (activePlayers.length === 1 && game.state.stack.length > 0) {
    priorityTimers.set(
      gameId,
      setTimeout(() => {
        doAutoPass(io, game, gameId, "auto-pass (single player)");
      }, 0)
    );
    return;
  }

  const startSeq = game.seq;
  const timeout = setTimeout(() => {
    priorityTimers.delete(gameId);
    const updatedGame = games.get(gameId);
    if (!updatedGame || updatedGame.seq !== startSeq) return;
    doAutoPass(io, updatedGame, gameId, "auto-pass (30s timeout)");
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
  const playerId = game.state.priority;
  if (!playerId) return;

  const { changed, resolvedNow } = game.passPriority(playerId);
  if (!changed) return;

  appendGameEvent(game, gameId, "passPriority", { by: playerId });

  if (resolvedNow) {
    appendGameEvent(game, gameId, "resolveTopOfStack");
    io.to(gameId).emit("chat", { gameId, message: "Top of stack resolved automatically." });
  }

  broadcastGame(io, game, gameId);
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
      const [first, second] = clean.split("/");
      result.hybrids.push([first, second]);
    } else if (result.colors.hasOwnProperty(clean)) {
      result.colors[clean] += 1;
    }
  }

  return result;
}