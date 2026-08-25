// server/src/state/modules/triggers/card-data-tables-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/triggers/card-data-tables.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/triggers/card-data-tables.ts.
// Leaves must not import card-data-tables.ts or this index.
// Never create card-data-tables/ beside card-data-tables.ts.

// Known activated tap/untap abilities (Dawnglare Invoker, Opposition, etc.).
export { KNOWN_TAP_UNTAP_ABILITIES } from "./cardDataTablesTapUntapAbilities.js";
