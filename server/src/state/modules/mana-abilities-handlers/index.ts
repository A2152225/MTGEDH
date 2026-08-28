// server/src/state/modules/mana-abilities-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/mana-abilities.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/mana-abilities.ts.
// Leaves must not import mana-abilities.ts or this index.

// ManaAbility / ManaModifier types, basic-land-type helpers, KNOWN_MANA_MODIFIERS, detectManaModifiers.
export {
  BASIC_LAND_TYPES,
  DEFAULT_BASIC_LAND_MANA_MAP,
  REALITY_TWIST_BASIC_LAND_MANA_MAP,
  detectManaModifiers,
  getEffectiveBasicLandTypes,
  getOverridingLandTypeModifier,
  isRealityTwistActive,
} from "./manaAbilityLandTypeModifiers.js";
export type { BasicLandType, ManaAbility, ManaModifier } from "./manaAbilityLandTypeModifiers.js";

// Chosen-color, Mox Amber, spend-restriction, power-threshold, commander identity.
export {
  getCommanderColorIdentity,
  getEffectivePowerForMana,
  getMoxAmberAvailableColors,
  getOpponentLandProducibleColorSymbols,
  isMoxAmberConditionalManaSource,
  parseManaSpendRestrictionFromOracle,
  parseSpelledOutManaAmount,
  resolveConditionalAnyColorProduces,
  resolvePermanentChosenColorSymbol,
  resolvePowerThresholdInsteadManaAbility,
} from "./manaAbilityColorRestrictionUtils.js";

// Native + granted tap-for-mana abilities for one permanent.
export { getManaAbilitiesForPermanent } from "./manaAbilitiesForPermanent.js";

// Continuous tap_for_* grants (Riftstone Portal / Cryptolith) → ManaAbility rows.
export { manaAbilitiesFromContinuousTapGrants } from "./manaAbilityContinuousTapGrants.js";
