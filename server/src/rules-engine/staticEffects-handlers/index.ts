// server/src/rules-engine/staticEffects-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/rules-engine/staticEffects.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/rules-engine/staticEffects.ts
// ("./staticEffects.js"). Never create staticEffects/ beside staticEffects.ts.

// Parse/battlefield helpers plus ContinuousEffectResult / EffectAggregate.
export {
  COLOR_WORDS,
  CREATURE_TYPES,
  GLOBAL_TYPE_ADDITIONS,
  parseCardCountWord,
  parseBuffSegment,
  resolveGrantedAbilities,
  isCreature,
  isLegendaryCreature,
  isColor,
  creatureHasManaColor,
  hasCreatureType,
  countOtherCreaturesSharingType,
  permanentCountsForControlTypeCondition,
} from "./staticEffectsScanHelpers.js";
export type { EffectAggregate, ContinuousEffectResult } from "./staticEffectsScanHelpers.js";

// Monument / creature-type lord / Coat of Arms / Sliver Legion phase.
export { applyMonumentLordAndSharedTypeEffects } from "./staticEffectsMonumentLordAndSharedType.js";
