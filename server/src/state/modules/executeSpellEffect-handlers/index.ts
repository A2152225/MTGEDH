// server/src/state/modules/executeSpellEffect-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/executeSpellEffect.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/executeSpellEffect.ts.
// Leaves must not import executeSpellEffect.ts or this index.

// Flicker return-at normalize, schedule, and exile-to-battlefield return.
export {
  normalizeFlickerReturnAt,
  scheduleExiledCardReturnToBattlefield,
  returnExiledCardToBattlefield,
  resolveFlickerReturnAfterExile,
} from "./executeSpellEffectFlickerHelpers.js";

// Legacy spell-effect switch dispatcher.
export { executeSpellEffect } from "./executeSpellEffectCore.js";
