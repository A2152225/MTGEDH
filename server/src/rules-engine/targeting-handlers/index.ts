// server/src/rules-engine/targeting-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/rules-engine/targeting.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/rules-engine/targeting.ts
// ("./targeting.js"). Never create targeting/ beside targeting.ts.

// SpellSpec and related public types.
export type {
  SpellOp,
  PermanentFilter,
  SpellTypeFilter,
  StatRequirement,
  TargetRestrictionType,
  TargetRestriction,
  SpellSpec,
} from "./targetingSpellSpecTypes.js";

// Word-to-number and title-case helpers for categorize templates.
export { parseCountWord, titleCaseWords } from "./targetingCategorizeCountUtils.js";

// Shared permanent-type filter detection for destroy/exile categorize patterns.
export { detectCategorizePermanentFilter } from "./targetingCategorizePermanentFilter.js";

// Graveyard target-type helpers, requiresTargeting, and parseTargetRequirements.
export {
  matchesGraveyardCardTargetType,
  requiresTargeting,
  parseTargetRequirements,
} from "./targetingParseTargetRequirements.js";
export type { GroupedTargetRequirement } from "./targetingParseTargetRequirements.js";

// SpellSpec-aligned has_keyword / power-toughness filters for IR-primary lists.
export {
  parseTargetRequirementStatKeywordFilters,
  stripTargetTypeRestrictionSuffix,
  attachParsedTargetRequirementStatKeywordFilters,
  permanentMatchesTargetRequirementStatKeywordFilters,
} from "./targetingParseTargetRequirementRestrictions.js";
export type { ParsedTargetRequirementStatKeywordFilters } from "./targetingParseTargetRequirementRestrictions.js";

// Bolt Bend / Redirect: stamped single target, or a single-target ability
// whose effect still needs a target (deferred Aura Shards-style triggers).
export {
  countStackItemTargets,
  stackItemHasExactlyOneTarget,
  stackItemMeetsSingleTargetRequirement,
} from "./targetingStackObjectSingleTarget.js";

// Untargeted mass bounce/removal whose affected set is attacking/blocking creatures.
export {
  inferUntargetedCombatRoleMassEffect,
  battlefieldHasUntargetedCombatRole,
  evaluateUntargetedCombatRoleMassEffectLegality,
} from "./targetingUntargetedCombatRoleMassEffect.js";
export type { UntargetedCombatRole } from "./targetingUntargetedCombatRoleMassEffect.js";

// categorizeSpellWithoutPrimaryRetirement pattern families (null = fall through).
export { tryCategorizeStackCounterSimpleTemplates } from "./targetingCategorizeStackCounterSimpleTemplates.js";
export { tryCategorizeScryMillMassRemoval } from "./targetingCategorizeScryMillMassRemoval.js";
export { tryCategorizeDamageFlickerRestrictions } from "./targetingCategorizeDamageFlickerRestrictions.js";
export { tryCategorizeTapBounceGenericTargets } from "./targetingCategorizeTapBounceGenericTargets.js";

// Hexproof/shroud lose vs controller-only as-though (Glaring Spotlight / Kaya).
export {
  protectionKeywordIgnoredForTargeting,
  protectionKeywordIgnoredForPlayerTargeting,
  asThoughAbilitySuppressedForTarget,
} from "./targetingProtectionKeywordStaticOverride.js";

// Player hexproof/shroud targeting legality (Leyline / Kaya as-though).
export { canPlayerBeTargetedByPlayer } from "./targetingPlayerProtectionKeyword.js";
