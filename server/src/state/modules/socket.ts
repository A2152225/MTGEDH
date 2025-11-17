// Compatibility shim: re-export the 'games' map from the socket layer so
// state modules under server/src/state/modules can import "./socket".
//
// This keeps the existing relative imports working without changing many files.
// If your real socket entry exports 'games' from a different file, adjust the path below.

export { games } from "../../socket/socket";