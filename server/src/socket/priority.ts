import type { Server, Socket } from "socket.io";
import { ensureGame, clearPriorityTimer, schedulePriorityTimeout } from "./util";

export function registerPriorityHandlers(io: Server, socket: Socket) {
  socket.on("clearPriorityTimer", ({ gameId }: { gameId: string }) => {
    try {
      clearPriorityTimer(gameId);
      socket.emit("priorityTimerCleared", { gameId });
    } catch {
      socket.emit("priorityTimerError", { gameId, message: "Failed to clear priority timer." });
    }
  });

  socket.on("schedulePriorityTimeout", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      schedulePriorityTimeout(io, game, gameId);
      socket.emit("priorityTimerScheduled", { gameId });
    } catch (err) {
      socket.emit("error", { code: "SCHEDULE_PRIORITY_ERROR", message: err.message });
    }
  });
}