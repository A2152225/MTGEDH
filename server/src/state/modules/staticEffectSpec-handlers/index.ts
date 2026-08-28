// server/src/state/modules/staticEffectSpec-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/staticEffectSpecOracleParsing.ts.
// Named re-exports only — no implementations, no `export *`.
// Never create staticEffectSpec/ beside staticEffectSpec.ts.

// Artifact/enchantment/land creature lords, outlaw designation, nontoken/attacking have.
export { pushTypedAndKeywordLordSpecs } from './staticEffectSpecOracleParsingTypedAndKeywordLords.js';

// Quoted have grants, city's blessing, historic-during-turn, base P/T, mana-ability anthems.
export { pushQuotedNumericAndBasePTLordSpecs } from './staticEffectSpecOracleParsingQuotedNumericBasePT.js';

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

// Continuous host combat locks (Pacifism / Bound in Silence) plus {T}-cost
// activation-lock token used by Serra Bestiary / Katabatic.
export {
  CANT_ATTACK,
  CANT_BLOCK,
  CANT_ACTIVATE_TAP_ABILITIES,
  sentenceHasTapActivationLock,
  appendTapActivationLockAbility,
  pushCantAttackBlockSpecs,
} from './staticEffectSpecOracleParsingCantAttack.js';

// Mass combat locks (Moat / Ensnaring Bridge / Katabatic attack/block/{T} /
// Peacekeeper / type-you-control).
export { pushMassCantAttackBlockSpecs } from './staticEffectSpecOracleParsingMassCantAttack.js';

// Pillowfort attack-you tax / prohibition (Ghostly Prison / Sphere / domain /
// {W/P} phyrexian / Elephant Grass / Blazing Archon / Form of the Dragon /
// Reverence / Combat Calligrapher / Vow host / Crawlspace / Teferi's Moat /
// Eriette / Silent Arbiter block cap / Archangel of Tithes block tax /
// Island Sanctuary except-keywords).
export { pushAttackYouTaxSpecs } from './staticEffectSpecOracleParsingAttackYouTax.js';
