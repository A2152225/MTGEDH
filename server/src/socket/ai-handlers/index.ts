/**
 * Internal agent TOC for clusters extracted from server/src/socket/ai.ts.
 *
 * Named re-exports only - no implementations, no `export *`. The public
 * compatibility barrel stays `server/src/socket/ai.ts`; leaves in this folder
 * must never import it (nor this index). Never create `socket/ai/`.
 */

// Shared AI timing, library-search, hand-size, and mana-color constants.
export {
  AI_FAST_CONTINUE_MS,
  AI_MANA_ABILITY_PATTERN,
  AI_MANA_COLOR_PRIORITY,
  AI_OPTIONAL_GIVE_CONTROL_PROBABILITY,
  AI_PASSIVE_STEP_DELAY_MS,
  AI_REACTION_DELAY_MS,
  AI_THINK_TIME_MS,
  COLOR_IDENTITY_MAP,
  INITIAL_HAND_SIZE,
  MAX_LIBRARY_SEARCH_LIMIT,
} from "./aiConstants.js";

// Persisted isAI player difficulty/name lookup shared by deck load and rehydrate.
export { getPersistedAIPlayerRuntimeData } from "./aiPlayerRuntimeData.js";

// Commander identity scoring, pregame deck load, autoSelectAICommander.
export {
  autoSelectAICommander,
  ensureAIPreGameDeckLoaded,
  getAILibraryCards,
  persistAIPlayerDeckSource,
  resolveAIDeckEntries,
} from "./aiPregameHandlers.js";

// Archetype weights, deck profile, theme/synergy scoring, hand-plan summary.
export {
  calculateCardSynergyPressure,
  calculateCardThemeAlignment,
  ensureAIDeckProfile,
  getAIBattlefield,
  getAIHand,
  getAIPlayerLife,
  permanentHasLeaveBattlefieldExileReplacement,
  rehydrateCardsById,
  scoreCardForAIAcquisition,
  scoreHostileGraveyardCardDisruption,
  summarizeAIHandPlan,
} from "./aiDeckProfileHandlers.js";

// AIEngine singleton, per-game AI map, scheduled gameFlow/priority timers.
export {
  aiActionsInProgress,
  aiEngine,
  aiPlayers,
  clearScheduledAIAction,
  clearScheduledAIActionsForGame,
  getAIActionKey,
  getAIPendingSpellCastStatus,
  runExclusiveAIAction,
  resetAIActionLocksForTests,
  getAIActionGenerationForTests,
  scheduleAIGameFlow,
  scheduleAIPriority,
} from "./aiScheduler.js";

// Pregame commander/deck recovery and post-delay priority schedule.
export { handleAIGameFlow } from "./aiGameFlowHandlers.js";

// Persist + broadcast AI keepHand the same way humans do (survives resume).
export { commitAIKeepHand } from "./aiKeepHand.js";

// London mulligan keep/mulligan decision for AI players.
export { handleAIMulligan } from "./aiMulliganHandlers.js";

// AI player register / rehydrate / unregister / isAIPlayer.
export {
  clearHumanAutopilotSeat,
  getAIPlayers,
  isAIPlayer,
  registerAIPlayer,
  rehydrateAIGameRuntime,
  rehydrateAIPlayerRuntime,
  unregisterAIPlayer,
} from "./aiPlayerRegistry.js";

// Join + deck load when adding an AI opponent to an existing pre-game table.
export {
  addAIOpponentToExistingGame,
  MAX_TOTAL_AI_TABLE_SEATS,
} from "./aiAddOpponentToGame.js";

// Pre-game remove of a seated AI opponent (removeAIFromGame).
export { removeAIOpponentFromExistingGame } from "./aiRemoveOpponentFromGame.js";

// Socket registration for createGame / addAI / toggle AI / strategies. Parent wraps this.
export { registerAIHandlers } from "./aiRegisterHandlers.js";

// createConfiguredGame used by registerAIHandlers.
export { createConfiguredGame } from "./aiGameSetupHandlers.js";

// Option-choice prompt helpers (tax, miracle, dredge, venture, exert, MDFC, ...).
export {
  chooseAIAdministrativeConfirmSelection,
  chooseAICastFreePromptSelection,
  chooseAIDredgeDrawReplacementSelection,
  chooseAISkipDrawReplacementSelection,
  chooseAIExertChoiceSelection,
  chooseAIForbiddenOrchardTargetSelection,
  chooseAILandWouldEnterSacrificeSelection,
  chooseAIMdfcFaceSelection,
  chooseAIMiraclePromptSelection,
  chooseAIMoxDiamondSelection,
  chooseAIOpponentMayPaySelection,
  chooseAIPlayerForLookedAtCardsSelection,
  chooseAIRevealLandSelection,
  chooseAISpellAdditionalCostBlightOrPaySelection,
  chooseAISpellBottomRevealUntilNonlandSelection,
  chooseAIVentureOptionSelection,
  chooseAIZursWeirdingOpponentSelection,
  getAIParsedManaCostAmount,
} from "./aiChoicePromptHandlers.js";

// May-reveal-hand then four-zone named-copy win (Hedron Alignment family).
export { chooseAIMayRevealHandWinIfOwnNamedSelection } from "./aiMayRevealHandWinChoiceHandlers.js";

// Permanent keyword set + P/T reads for keyword-counter scoring.
export { getPermanentCombatStats, getPermanentKeywordSet } from "./aiPermanentCombatStats.js";

// Library-search / graveyard / scry / hideaway / reflexive choice helpers.
export {
  chooseAIGraveyardSelectionIds,
  chooseAIHideawayCardId,
  chooseAILibrarySearchCards,
  chooseAILibrarySearchResponse,
  chooseAIOptionalDiscardThenDrawSelection,
  chooseAIReflexiveFixedPaymentSelection,
  chooseAIReflexiveManaPaymentSelection,
  chooseAIReflexiveSacrificeSelection,
  chooseAIReturnControlledPermanentId,
  chooseAISacrificeAnotherPermanentForBenefitSelection,
  chooseAIScrySelection,
  chooseAIUpkeepSacrificeSelection,
  scoreGenericChoiceOption,
  scoreProtectedObjectForWard,
} from "./aiZoneSearchChoiceHandlers.js";

// Two-pile, exile-grant, keyword-counter, put-from-hand, and related option choosers.
export {
  chooseAIAttachEquipmentToPermanentChoiceSelection,
  chooseAIChooseDiscardPlanSelection,
  chooseAIChooseManaColorsSelection,
  chooseAIChoosePlayerForTwoPileSplitSelection,
  chooseAICopyRetargetSelection,
  chooseAIForceOfWillExileSelection,
  chooseAIGrantPlayableFromExileSelection,
  chooseAIKeywordCounterSelectionsForStep,
  chooseAILookedAtCardsDestinationSelection,
  chooseAIMoveChosenHandCardToLibrarySelection,
  chooseAIOptionalPaymentPromptSelection,
  chooseAIPayManaToLookAndChooseCardSelection,
  chooseAIPileFromSplitSelection,
  chooseAIPutFromHandSelectionsForStep,
  chooseAIReflexiveBoundGraveyardSelfExileSelection,
  chooseAIReflexiveConvertSelection,
  chooseAIReflexiveDiscardSelection,
  chooseAIReflexiveGraveyardExileSelection,
  chooseAIResolvedSpellCopySelection,
} from "./aiPileAndKeywordChoiceHandlers.js";

// Activated-ability snapshot/resolver type aliases.
export type {
  AIAbilityActivationSnapshot,
  AIActivatedAbilityResolverCandidate,
  AIResolvedActivatedAbilityAction,
} from "./aiAbilityActivationTypes.js";

// Player-id and named-card choice helpers.
export { chooseAICardNameSelection, chooseAIPlayerChoiceId } from "./aiPlayerCardNameChoiceHandlers.js";

// Spell and choice-step target scoring / selection.
export {
  chooseAITargetSelectionsForChoiceStep,
  chooseAITargetsForSpell,
  findZoneCardById,
} from "./aiTargetChoiceHandlers.js";

// Mode / overload / Kynaios choice helpers.
export {
  chooseAIKynaiosChoiceSelection,
  chooseAIModeSelectionsForStep,
} from "./aiModeChoiceHandlers.js";

// Option-choice dispatcher over extracted prompt helpers.
export { chooseAIOptionSelectionsForStep } from "./aiOptionChoiceHandlers.js";

// Game-end cleanup and pending-modal / blocker-declaration checks.
export {
  checkPendingModals,
  cleanupGameAI,
  getPendingBlockerDeclaration,
} from "./aiGameCleanupHandlers.js";

// Pass priority and declare attackers/blockers executors used by handleAIPriority.
export {
  executeDeclareAttackers,
  executeDeclareBlockers,
  executePassPriority,
} from "./aiPriorityPassCombatExecutors.js";

export {
  collectAIManaColorNeedWeights,
  pickAIManaColorByNeedWeights,
  shouldAIPreferPaidScalingManaOverColorlessTap,
} from "./aiManaColorNeedHelpers.js";

// Mana production, additional-cost payability, and activation color choice.
export {
  applyAIManaLifeLoss,
  calculateAvailableMana,
  canAIPayAdditionalCost,
  chooseAIManaColorForActivation,
  getAIManaProductionOptions,
  getManaProduction,
  hasCreatureSummoningSickness,
  hasManaAbility,
  scoreAISacrificePermanentForManaAbility,
} from "./aiManaCostHelpers.js";

// handleAIResolutionStep case families; parent keeps the switch dispatcher.
export { handleAIResolutionTriggerAndChoiceSteps } from "./aiResolutionTriggerAndChoiceSteps.js";
export { handleAIResolutionSearchAndNameSteps } from "./aiResolutionSearchAndNameSteps.js";
export { handleAIResolutionPaymentAndTargetSteps } from "./aiResolutionPaymentAndTargetSteps.js";
export { handleAIResolutionKeywordAndMiscSteps } from "./aiResolutionKeywordAndMiscSteps.js";

// Step advance and AIDecisionType dispatch.
export { executeAdvanceStep, executeAIDecision } from "./aiAdvanceAndDecisionExecutors.js";

// Legacy tap-for-mana / activate-ability executor.
export { executeAILegacyActivateAbility } from "./aiLegacyActivateAbilityHandlers.js";

// Short activation-state snapshot used by shared/legacy activate paths.
export { snapshotAIAbilityActivationState } from "./aiAbilityActivationSnapshot.js";

// Indented mana/payment/activation helpers hoisted from beside snapshotAIAbilityActivationState.
export {
  chooseAIReturnToHandPermanentForManaAbility,
  getAINonTapManaActionAmount,
  permanentHasAIManaAbilityResolverCandidates,
  resolveAIPaymentManaAbilityId,
  selectAIManaRetentionActivationAction,
  selectAINonTapManaActivationAction,
  tryActivateAINonTapManaAbilityForSpellPaymentSimulation,
  tryAIManaBatteryColorFixForSpellPayment,
  tryAIManaBatteryColorFixForSpellPaymentSimulation,
} from "./aiManaActivationHelpers.js";

// Spell-payment plan assembly, sacrifice-for-mana, and chooseAISpellPaymentSelections.
export {
  buildAIAvailableManaForSpellPayment,
  buildAISpellPaymentPlan,
  canAIAssembleSpellPaymentPlan,
  chooseAssembleableSpellXValueFromStep,
  chooseAISacrificePermanentForManaAbility,
  chooseAISacrificePermanentsForManaAbility,
  chooseAISpellPaymentSelections,
  cloneAISpellPaymentSimulationGame,
  getAINonTapManaAbilityCandidates,
} from "./aiSpellPaymentPlanHelpers.js";

// Untapped mana-source selection for spell payment.
export { getPaymentSources } from "./aiPaymentSources.js";
export {
  spendRestrictionGrantsUncounterableChosenTypeCast,
} from "./aiUncounterableChosenTypeMana.js";

// Action-candidate type aliases for priority / cast / land enumeration.
export type {
  AIActionCandidate,
  AIActionCandidateQuery,
  AIActionSelectionMode,
  AIActivatedAbilityCandidate,
  AICastableCommanderCandidate,
  AICastableSpellCandidate,
  AICastAttemptDescriptor,
  AICastRequestSourceZone,
  AIPlayableLandCandidate,
  AISupportedCardSourceZone,
} from "./aiActionCandidateTypes.js";

// Main AI priority decision loop.
export { handleAIPriority } from "./aiPriorityHandlers.js";

// Affordable-spell enumeration for main-phase and response candidates.
export { findCastableSpells } from "./aiFindCastableSpells.js";
// Join Forces: wait for leftover + other-player mana; AIs pay into shared-positive X.
export {
  MIN_JOIN_FORCES_POTENTIAL_MANA,
  chooseAIJoinForcesContribution,
  evaluateAIJoinForcesCast,
  shouldAICastJoinForcesSpell,
} from "./aiJoinForcesDecision.js";

// AI autoPassLoop: treat legal-but-pointless instants/flash as idle.
export { isAiContextuallyIdleForAutoPass } from "./aiAutoPassContextualIdle.js";
// Elixir-like gain-life/shuffle stays live when life, GY, or a removal threat matters.
export { hasUsefulAiActivatedAbilityForAutoPass, isElixirLikeAbilityUsefulNow } from "./aiActivatedAbilityContextualIdle.js";

// Mana-retention land tapping before combat.
export {
  checkShouldTapLandsForManaRetention,
  executeAITapLandsForMana,
} from "./aiLandTapHandlers.js";

// Shock/bounce land helpers, executeAIPlayLand, handleBounceLandETB.
export { executeAIPlayLand, handleBounceLandETB } from "./aiLandPlayHandlers.js";

// Shared/legacy battlefield ability activation.
export {
  executeAIActivateAbility,
  isAIManaBatteryChargeInvestAction,
} from "./aiActivateAbilityHandlers.js";

// End step before this player's turn: spare mana readies a tapped doesn't-untap mana rock.
export {
  findManaRockToReadyBeforeNextTurn,
  findManaRocksToTapBecauseOtherPlayersUntapThem,
  isEndStepBeforePlayersTurn,
  tryAIReadyManaRockBeforeNextTurn,
  tryAITapManaRocksOtherPlayersWillUntap,
} from "./aiManaRockEndStepUntap.js";

// Activated-ability id resolution and shared battlefield activation request.
export {
  buildAIActivatedAbilityResolverCandidates,
  didAIAbilityActivationProgress,
  requestAISharedBattlefieldAbilityActivation,
  resolveAIActivatedAbilityId,
} from "./aiActivatedAbilityResolver.js";

// Spell-cast ordering scores for findCastableSpells / response windows.
export { calculateSpellPriority } from "./aiSpellPriority.js";

// Action-candidate enumeration, mana-payment plan, response-window actions.
export {
  canAIActivateBattlefieldAbilityNow,
  canAIAssembleManaPaymentPlan,
  captureAICastControlFlowSnapshot,
  didAICastAttemptChangeControlFlow,
  enumerateAIActionCandidates,
  tryAIResponseActions,
  waitForAISharedCastToSettle,
} from "./aiActionCandidateHandlers.js";

// Playable-land lookup, aura targeting, findCastableCommander, failed-cast memory.
export {
  applyAISelectedLandFace,
  findCastableCommander,
  chooseAIPlayableLandCandidate,
  findPlayableLand,
  isAIFailedSpellCastCard,
  isCardAlreadyOnBattlefield,
  rememberAIFailedSpellCast,
} from "./aiLandAuraCommander.js";

// Shared requestCastSpell / handlePlayLand request wrappers for AI.
export { requestAISharedCast, requestAISharedLandPlay } from "./aiSharedCastLand.js";
