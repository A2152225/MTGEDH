// server/src/state/modules/stackResolvePermanentEntryUtils-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/stackResolvePermanentEntryUtils.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays
// server/src/state/modules/stackResolvePermanentEntryUtils.ts.
// Leaves must not import stackResolvePermanentEntryUtils.ts or this index.

// Queue mutate triggered abilities onto the stack (mutated-stack + detectMutateTriggers).
export { queueMutateTriggeredAbilities } from "./queueMutateTriggeredAbilities.js";
