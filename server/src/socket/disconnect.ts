import type { Server, Socket } from "socket.io";
import { games, priorityTimers } from "./socket";
import { broadcastGame } from "./util";

export function registerDisconnectHandlers(io: Server, socket: Socket) {
  // Player manually leaves the game
  socket.on("leaveGame", ({ gameId }: { gameId: string }) => {
    const game = games.get(gameId);
    const playerId = socket.data.playerId;

    if (!game || !playerId) return;

    const left = game.leave(playerId);
    socket.leave(gameId);

    if (left) {
      game.applyEvent({ type: "leave", playerId });
      broadcastGame(io, game, gameId);
    }
  });

  // Handle socket disconnection
  socket.on("disconnect", () => {
    const gameId = socket.data.gameId;
    const playerId = socket.data.playerId;

    if (!gameId || !games.has(gameId)) return;

    const game = games.get(gameId)!;
    game.disconnect(socket.id);

    // Clear priority timer if the disconnected player had priority
    if (game.state.priority === playerId) {
      const timer = priorityTimers.get(gameId);
      if (timer) clearTimeout(timer);
    }
  });
}