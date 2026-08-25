// server/src/state/utils-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of server/src/state/utils.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/utils.ts ("./utils.js").

// Characteristic-defining */* power/toughness (Tarmogoyf, Nighthowler, …).
export { calculateVariablePT } from "./variablePTCalculator.js";

// Type-line subtype split used by attached P/T bonus parse helpers.
export { extractCreatureTypes } from "./ptTypeLineCreatureTypes.js";

// Attached equipment/aura P/T parse, set-base-P/T auras, Trepanation Blade predicates.
export {
  resolveSetBasePTFromAttachedAuras,
  isEquippedAttackRevealUntilLandPump,
  getEquippedAttackRevealPumpPowerPerCard,
  shouldUseAttachedBonusNameTable,
  parseStaticAttachedPTBonusFromOracle,
  resolveAttachedPTBonusFromOracle,
} from "./ptAttachedBonusParseHelpers.js";

// Legacy empty equipment/aura name tables used when oracle_text is missing.
export { EQUIPMENT_BONUSES, AURA_BONUSES } from "./ptAttachedBonusNameTables.js";

// Attached equipment/aura P/T sum (Cranial Plating, Blackblade, Trepanation Blade).
export { calculateEquipmentBonus } from "./ptEquipmentBonusCalculator.js";

// Combined P/T bonuses from lords, anthems, equipment, counters.
export { calculateAllPTBonuses } from "./ptAllBonusesCalculator.js";

// P/T bonuses with tooltip source tracking, plus equipment/aura source breakdown.
export {
  calculateAllPTBonusesWithSources,
  calculateEquipmentBonusWithSources,
} from "./ptAllBonusesWithSources.js";
export type { PTBonusSource, PTBonusResult } from "./ptAllBonusesWithSources.js";
