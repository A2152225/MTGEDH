// server/src/state/modules/staticEffectSpec-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/staticEffectSpecOracleParsing.ts.
// Named re-exports only — no implementations, no `export *`.
// Never create staticEffectSpec/ beside staticEffectSpec.ts.

// Shared parse helpers (ability tails, buffs, buildSpec).
export {
  ABILITY_WORDS,
  COLOR_WORDS,
  parseCardCountWord,
  parseBuffSegment,
  parseAbilitiesFromTail,
  resolveChosenOptionsFromPermanent,
  pushPlayerAbilityGrantsFromList,
  parseLordAbilitiesFromTail,
  parseLordCreatureType,
  buildSpec,
} from './staticEffectSpecOracleParseHelpers.js';
export type { StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';

// GY + basic-land-type keyword grants (Anger / Wonder / Brawn / Filth / Valor).
export {
  oracleHasGraveyardLandKeywordGrant,
  pushGraveyardLandKeywordGrantSpecs,
} from './staticEffectSpecOracleParsingGraveyardLandKeywords.js';

// Player hexproof/shroud, you-and-type grants, other/opponent P/T polarity.
export {
  pushPlayerHexproofAndConditionalGrantSpecs,
  pushOtherCreatureAndOpponentPolaritySpecs,
} from './staticEffectSpecOracleParsingAsLongAsAndPolarity.js';

// Tap-for-mana grants (Cryptolith Rite / lands you control).
export { pushManaAbilityGrantSpecs } from './staticEffectSpecOracleParsingManaAbilityGrants.js';

// Tapped / untapped creature keyword grants (Saryth).
export { pushTapUntapAbilityGrantSpecs } from './staticEffectSpecOracleParsingTapUntapAbilityGrants.js';

// Lure / must-be-blocked-if-able host grants.
export {
  MUST_BE_BLOCKED_IF_ABLE,
  ALL_ABLE_CREATURES_MUST_BLOCK,
  pushMustBeBlockedSpecs,
} from './staticEffectSpecOracleParsingMustBeBlocked.js';

// Typed “must be blocked by a creature with [keyword] if able” host grants.
export {
  MUST_BE_BLOCKED_BY_PREFIX,
  typedMustBeBlockedAbility,
  keywordFromMustBeBlockedByAbility,
  pushMustBeBlockedByTypeSpecs,
} from './staticEffectSpecOracleParsingMustBeBlockedByType.js';

// Opponent creatures lose / as-though-didn't-have keywords.
export { pushLoseKeywordSpecs } from './staticEffectSpecOracleParsingLoseKeywords.js';
