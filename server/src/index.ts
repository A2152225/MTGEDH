import { registerSocketHandlers } from "./socket";

const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(/* your config */);

registerSocketHandlers(io);