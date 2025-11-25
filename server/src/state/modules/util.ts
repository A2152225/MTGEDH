// server/src/state/modules/util.ts
// Compatibility shim for state modules that import "./util".
// Re-export socket-level helpers so existing state modules (join.ts, replay.ts, etc.)
// continue to work after refactors.
//
// This is intentionally tiny and non-invasive: it just re-exports the canonical
// implementations from server/src/socket/util.ts used elsewhere in the server.
export {
  ensureGame,
  broadcastGame,
  appendGameEvent,
  clearPriorityTimer,
  schedulePriorityTimeout,
} from "../../socket/util.js";