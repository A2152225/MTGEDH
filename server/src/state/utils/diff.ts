// server/src/state/utils/diff.ts
// Compatibility shim so state modules can import "../utils/diff".
// Re-export the canonical computeDiff implementation from server/src/utils/diff.

export { computeDiff } from "../../utils/diff";