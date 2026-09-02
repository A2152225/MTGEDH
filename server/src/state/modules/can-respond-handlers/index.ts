// server/src/state/modules/can-respond-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/can-respond.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/can-respond.ts.
// Leaves must not import can-respond.ts or this index.

// Shared spell / land / commander candidate types.
export type {
  SharedSpellSourceZone,
  SharedSpellCandidateMode,
  SharedSpellCandidatePayability,
  SharedSpellCastMethod,
  SharedLandSourceZone,
  SharedSourceGrantedAdditionalCost,
  SharedSpellCastCandidate,
  SharedPlayableLandCandidate,
  SharedCommanderParsedCost,
  SharedCommanderBaseCandidate,
  SharedCommanderAvailabilityCandidate,
  SharedCommanderCastCandidate,
} from "./canRespondTypes.js";

// Transform back-face oracle pattern (not playable from hand).
export { isTransformBackFace } from "./canRespondTransformBackFace.js";

// Split Second stack lock and land type-line predicate.
export { isSplitSecondLockActive, isLandTypeLine } from "./canRespondSplitSecondLandPredicates.js";

// Top-of-library permission, flash/instant, flashback, foretell, playable-from-exile.
export {
  getTopLibraryCard,
  getTopLibrarySpellPermission,
  canPlayTopLibraryLand,
  hasFlashOrInstant,
  hasFlashback,
  hasForetellOrCanCastFromExile,
  isCardPlayableFromExile,
} from "./canRespondTopLibraryFlashExile.js";

// a/an/one..ten word-number parser used by GY additional costs and activations.
export { parseWordNumberForGraveyardCost } from "./canRespondParseWordNumber.js";

// Permanent vs sorcery-speed type-line predicates.
export { isPermanentSpellType, isSorcerySpeedSpellCard } from "./canRespondSpellTypePredicates.js";

// First-class GY permission matching, qualifiers, and synthetic metadata.
export {
  normalizeRuleText,
  buildSyntheticGraveyardPermissionMetadata,
  findMatchingFirstClassGraveyardPermission,
  firstClassPermissionLeaveBattlefieldDestination,
  firstClassPermissionLeaveBattlefieldLifeGain,
  getGraveyardPermissionCostModeFromText,
  hasMarkedGraveyardPermission,
  isPlayersTurnForPermission,
  getGraveyardPermissionTextSources,
  isStaticGraveyardPermissionLine,
  spellQualifierMatchesCard,
  firstClassPermissionExilesSpell,
  getGraveyardPermanentTypesCastThisTurn,
  landQualifierMatchesCard,
} from "./canRespondGraveyardPermissionMatching.js";

// GY spell permission, additional costs, and leave-battlefield replacements.
export {
  canPaySourceGrantedAdditionalCost,
  getSpecificSpellFromGraveyardPermission,
  getSourceGrantedAdditionalCost,
  sourceLeaveBattlefieldReplacementDestination,
  sourceLeaveBattlefieldLifeGain,
} from "./canRespondGraveyardSpellPermission.js";

// GY land play permission.
export { getSpecificLandFromGraveyardPermission, canPlaySpecificLandFromGraveyard } from "./canRespondGraveyardLandPermission.js";

// Adventure/DFC/split face evaluation and any-type mana cost normalization.
export { getHandCastEvaluationCards, normalizeParsedCostForAnyTypeManaSpending } from "./canRespondHandCastEvaluation.js";

// Castable spell candidates across hand / GY / exile / library.
export { getCastableSpellCandidates } from "./canRespondCastableSpellCandidates.js";

// Per-priority-pass cache for spell candidates / canRespond / canAct.
export { getOrComputeCachedBoolean, getOrComputeCachedSpellCandidates } from "./canRespondPriorityCache.js";

export { isInMainPhase } from "./canRespondMainPhase.js";
export { canCastAnySpell } from "./canRespondCanCastAnySpell.js";
export { isActivatedAbilityConditionMet } from "./canRespondActivatedAbilityCondition.js";

// Battlefield / GY / exile / hand activated abilities and canActivateAnyAbility.
export {
  canActivateAnyAbility,
  hasActivatableAbility,
  hasSacrificePrefixActivatedAbility,
  hasActivatableLoyaltyAbility,
} from "./canRespondActivatableAbilities.js";

// Command-zone commander cast candidates.
export { getCommandZoneCommanderCandidates, getCastableCommanderCandidates } from "./canRespondCommandZoneCandidates.js";

// Land-play candidates, canPlayLand, and play-from-zone/top-library effects.
export {
  getPlayableLandCandidates,
  canPlayLand,
  isCardPlayableAsLandFromHand,
  getPlayableLandFaceIndex,
  getHandCastEvaluationCard,
} from "./canRespondPlayableLands.js";
