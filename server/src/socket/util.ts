import { games } from "./socket";
import { appendEvent } from "../db";
import { Server } from "socket.io";

/**
 * Ensures that the specified game exists in memory, otherwise throws an error.
 */
export function ensureGame(gameId: string) {
  const game = games.get(gameId);
  if (!game) {
    throw new Error(`Game ${gameId} not found.`);
  }
  return game;
}

/**
 * Broadcasts the full state of a game to all connected participants using the Socket.IO server.
 */
export function broadcastGame(io: Server, game: any, gameId: string) {
  const participants = game.participants();
  for (const { socketId, playerId, spectator } of participants) {
    const view = game.viewFor(playerId, Boolean(spectator));
    io.to(socketId).emit("state", { gameId, view, seq: game.seq });
  }
}

/**
 * Appends a game event to both the database and the in-memory game instance.
 */
export function appendGameEvent(game: any, gameId: string, type: string, payload: Record<string, any> = {}) {
  game.applyEvent({ type, ...payload });
  appendEvent(gameId, game.seq, type, payload);
}