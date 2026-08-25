// server/src/state/modules/triggers/zone-change-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/triggers/zone-change.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/triggers/zone-change.ts.
// Leaves must not import zone-change.ts or this index.
// Never create triggers/zone-change/ beside zone-change.ts
// (zone-changes.ts is a different barrel for death/ETB/attack).

// Exile-from-battlefield detector + wire type (not death/ETB/attack).
export { detectExiledFromBattlefieldTriggers, type ExiledFromBattlefieldTrigger } from "./exileFromBattlefieldDetection.js";
