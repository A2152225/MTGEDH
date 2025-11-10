import type { Server, Socket } from "socket.io";
import { appendEvent } from "../db";
import { games, priorityTimers } from "./socket";
import { broadcastGame } from "./util";

export function registerDisconnectHandlers(io: Server, socket: Socket) {
  // Handle player leaving a game manually
  socket.on("leaveGame", ({ gameId }: { gameId: string }) => {
    const playerId = socket.data.playerId;
    if (!playerId || !games.has(gameId)) return;

    const game = games.get(gameId)!;
    const left = game.leave(playerId);

    socket.leave(gameId);
    if (left) {
      appendEvent(gameId, game.seq, "leave", { playerId });
      broadcastGame(io, game, gameId);
    }
  });

  // Handle graceful socket disconnection
  socket.on("disconnect", () => {
    const gameId = socket.data.gameId;
    const playerId = socket.data.playerId;

    if (!gameId || !games.has(gameId)) return;

    const game = games.get(gameId)!;
    game.disconnect(socket.id);

    // Reschedule timer if the priority holder disconnected
    if (game.state.priority === playerId) {
      const timer = priorityTimers.get(gameId);
      if (timer) clearTimeout(timer);
    }
  });
}