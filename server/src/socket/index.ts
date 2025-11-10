import { registerDisconnectHandlers } from "./disconnect";

// In the `io.on("connection")` block
registerDisconnectHandlers(io, socket);