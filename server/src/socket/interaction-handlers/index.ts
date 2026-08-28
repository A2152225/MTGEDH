/**
 * socket/interaction-handlers/index.ts
 *
 * Internal table of contents for clusters extracted out of
 * server/src/socket/interaction.ts. Named re-exports only - no implementations,
 * no `export *`. Leaves must never import interaction.ts or this index.
 *
 * The public/compatibility barrel stays socket/interaction.ts.
 */

// Tutor detection + library-search criteria parsing (creature type tables included).
export {
  detectTutorEffect,
  getUpgradedCreatureTypes,
  parseSearchCriteria,
  type TutorInfo,
} from "./interactionTutorSearchCriteriaParsing.js";

// Mana-ability activation shape: which mana ability was tapped, what it produces.
export {
  getAnyColorBonusManaAmount,
  getChosenTypeManaSelectionFields,
  queueAnyColorBonusManaSelection,
  resolveManaAbilityActivationShape,
} from "./interactionManaAbilityActivationShape.js";

// Graveyard-cast costs (flashback/escape/retrace/...) and activation-timing guards.
export {
  enforceGraveyardSpellCastTiming,
  enforceSorcerySpeedGraveyardAbility,
  getBattlefieldActivationTimingRestrictionError,
  getCastFromGraveyardActivationCost,
  getCastFromGraveyardDiscardCost,
  getCastFromGraveyardExileCost,
  getCastFromGraveyardResourceValidationError,
  getCastFromGraveyardSacrificeCost,
  getDirectGraveyardCastReplayMetadata,
  getEligiblePermanentsForSacrificeCost,
  getExplicitGraveyardActivationCost,
  getKeywordGraveyardActivationManaCost,
  isBattlefieldSorcerySpeedWindow,
  markCardLeftGraveyardLive,
  markCastFromGraveyardLive,
  queueSelfEtbForLiveGraveyardEntry,
} from "./interactionGraveyardCastCostAndTimingRules.js";

// Replay-event persistence for queued battlefield/graveyard ability activations.
export {
  calculateInteractionManaPoolDelta,
  matchesParsedGraveyardCardTargetType,
  persistQueuedBattlefieldAbilityStepActivation,
  persistQueuedGraveyardAbilityStepActivation,
  snapshotInteractionManaPool,
} from "./interactionActivationEventPersistence.js";

// Graveyard-cast stack card, aura/spell valid targets, TARGET_SELECTION queuing.
export {
  buildGraveyardCastSpellCard,
  normalizeSelectedTargetIds,
  queueGraveyardSpellCastTargetSelection,
} from "./interactionGraveyardSpellCastTargeting.js";

// Graveyard-cast apply/resume (flashback/disturb/...) plus encore token helpers.
export {
  continueCastFromGraveyardAbility,
  createEncoreToken,
  finalizeGraveyardSpellCast,
  getEncoreTargetPlayerIds,
  getNextEndStepFireTurnNumber,
} from "./interactionGraveyardCastExecution.js";

// Cycling / typecycling keyword lines -> activation definitions.
export {
  getCyclingDefinitionForActivation,
  type CyclingActivationDefinition,
} from "./interactionCyclingActivationDefinitions.js";

// Special-land ability table + hideaway activation condition / life-cost parse.
export {
  SPECIAL_LAND_ABILITIES,
  WORD_TO_NUMBER,
  evaluateHideawayActivationCondition,
  getLifePaymentForActivationCost,
} from "./interactionSpecialLandAndHideaway.js";

// Battlefield array accessor + EnsureInRoomAndSeated type for extracted sockets.
export {
  getBattlefield,
  type EnsureInRoomAndSeated,
} from "./interactionRoomAndBattlefield.js";

// Explore / batch-explore socket handlers lifted out of registerInteractionHandlers.
export {
  handleBeginBatchExploreRequest,
  handleBeginExploreRequest,
} from "./interactionExploreSocketHandlers.js";

// Library-search socket handler plus Aven Mindcensor / Stranglehold helpers.
export { handleLibrarySearchRequest } from "./interactionLibrarySearchSocketHandlers.js";

// Graveyard-contents view socket handler lifted out of registerInteractionHandlers.
export { handleGraveyardViewRequest } from "./interactionGraveyardViewSocketHandlers.js";

// Bulk-tap-for-mana and untap-permanent socket handlers.
export {
  handleBulkTapPermanentsForManaRequest,
  handleUntapPermanentRequest,
} from "./interactionBulkTapUntapSocketHandlers.js";

// Graveyard-ability activation socket handler (flashback/unearth/embalm/encore/...).
export { handleActivateGraveyardAbilityRequest } from "./interactionGraveyardAbilitySocketHandlers.js";

// Shared context for activateBattlefieldAbility family peels.
export type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";

// Special-land family of activateBattlefieldAbility (hybrid/storage/animate/hideaway).
export { tryHandleActivateSpecialLand } from "./interactionActivateSpecialLand.js";

// Fetch-land family of activateBattlefieldAbility.
export { tryHandleActivateFetchLand } from "./interactionActivateFetchLand.js";

// Sacrifice-to-draw family of activateBattlefieldAbility.
export { tryHandleActivateSacrificeDraw } from "./interactionActivateSacrificeDraw.js";

// Grant-keyword / control-change / fight / counter / tap-untap families.
export { tryHandleActivateGrantFightCounterTap } from "./interactionActivateGrantFightCounterTap.js";
// Grant-ability target phrase (target Dinosaur / target creature you control).
export { parseGrantAbilityCreatureTarget } from "./interactionActivateGrantAbilityTargetParse.js";

// Level-up / outlast / monstrosity / adapt / creature-upgrade families.
export { tryHandleActivateLevelOutlastUpgrade } from "./interactionActivateLevelOutlastUpgrade.js";

// Planeswalker loyalty (pw-ability-N) family of activateBattlefieldAbility.
export { tryHandleActivatePlaneswalker } from "./interactionActivatePlaneswalker.js";

// Other-ability parse/setup before generic activate (cost, power-up, exhaust, timing).
export {
  trySetupActivateBattlefieldAbilityParse,
  type ActivateBattlefieldAbilityParseState,
} from "./interactionActivateBattlefieldAbilityParseSetup.js";

// Shared mutation bag for generic non-mana / mana / persist activate peels.
export type {
  ActivateGenericAbilityExtras,
  ActivateGenericAbilityMutationState,
} from "./interactionActivateGenericAbilityState.js";

// Generic non-mana activateBattlefieldAbility if-body (stack, tutors, targeting).
export { tryHandleActivateGenericNonMana } from "./interactionActivateGenericNonMana.js";

// Generic mana activateBattlefieldAbility else-body (immediate mana production).
export { tryHandleActivateGenericMana } from "./interactionActivateGenericMana.js";

// Trailing persist after both generic activate branches (bumpSeq, cost apply, replay).
export { applyActivateBattlefieldAbilityPersist } from "./interactionActivateBattlefieldAbilityPersist.js";

// Sacrifice-as-cost TARGET_SELECTION prompt (non-self sacrifice types).
export { tryHandleActivateSacrificeCostPrompt } from "./interactionActivateSacrificeCostPrompt.js";

// Pay-life / exile-from-graveyard / remove-counters activation-cost families.
export { tryHandleActivatePayLifeExileCounters } from "./interactionActivatePayLifeExileCounters.js";

// Replacement-effect ordering + cycling sockets.
export { registerReplacementAndCyclingSocketHandlers } from "./interactionReplacementAndCyclingSocketHandlers.js";

// Top-level activateBattlefieldAbility helpers lifted from the parent.
export {
  parseTapUntapAbilityText,
  queueCounterTargetStepForBattlefieldAbility,
  getActivatedAbilityScopeText,
  buildActivatedAbilityOracleTextForStack,
} from "./interactionActivateBattlefieldAbilityHelpers.js";

// Equip / fortify / reconfigure family of activateBattlefieldAbility.
export { tryHandleActivateEquipFortifyReconfigure } from "./interactionActivateEquipFortifyReconfigure.js";

// Crew / station family of activateBattlefieldAbility.
export { tryHandleActivateCrewStation } from "./interactionActivateCrewStation.js";

// Mana-ability family of activateBattlefieldAbility (tap-mana / native / Doubling Cube).
export { tryHandleActivateMana } from "./interactionActivateMana.js";

// Cost-prompt family: tap-other / return-to-hand / blight.
export { tryHandleActivateCostPromptTapBlight } from "./interactionActivateCostPromptTapBlight.js";

// tapPermanent socket handler lifted out of registerInteractionHandlers.
export { handleTapPermanentRequest } from "./interactionTapPermanentSocketHandlers.js";

// Cost-prompt family: discard / exile-from-hand.
export { tryHandleActivateCostPromptDiscardExileHand } from "./interactionActivateCostPromptDiscardExileHand.js";

// exchangeTextBoxes / sacrificePermanent socket handlers.
export {
  handleExchangeTextBoxesRequest,
  handleSacrificePermanentRequest,
} from "./interactionExchangeSacrificeSocketHandlers.js";
