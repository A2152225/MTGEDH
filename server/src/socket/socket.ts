import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from "../../shared/src";
import { registerJoinHandlers } from "./join";
import { registerGameActions } from "./game-actions";
import { registerCommanderHandlers } from "./commander";
import { registerDeckHandlers } from "./deck";
import { registerInteractionHandlers } from "./interaction";
import { registerDisconnectHandlers } from "./disconnect";

// Globals shared across modules
export const games = new Map<GameID, InMemoryGame>();
export const priorityTimers = new Map<GameID, NodeJS.Timeout>();
export const PRIORITY_TIMEOUT_MS = 30_000;

// Main handler registration
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function registerSocketHandlers(io: TypedServer) {
  io.on("connection", (socket: Socket) => {
    // Register handlers from separate modules
    registerJoinHandlers(io, socket);
    registerGameActions(io, socket);
    registerCommanderHandlers(io, socket);
    registerDeckHandlers(io, socket);
    registerInteractionHandlers(io, socket);
    registerDisconnectHandlers(io, socket);
  });
}