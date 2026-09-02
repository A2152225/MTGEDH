/**
 * socket/resolution-handlers/index.ts
 *
 * Internal table of contents for response handlers extracted out of
 * server/src/socket/resolution.ts. Named re-exports only - no implementations,
 * no `export *`. Leaves must never import resolution.ts or this index.
 *
 * Runtime injection happens in socket/resolutionHandlerDeps.ts.
 */

// EXPLORE_DECISION / BATCH_EXPLORE_DECISION (CR 701.40 explore).
export {
  handleBatchExploreDecisionResponse,
  handleExploreDecisionResponse,
} from "./exploreDecisionResponseHandlers.js";

// FIGHT_TARGET: validate the fight target and push the fight ability on the stack.
export { handleFightTargetResponse } from "./fightTargetResponseHandlers.js";

// TAP_UNTAP_TARGET: tap/untap effects plus the tap-another-permanent activation cost resume.
export { handleTapUntapTargetResponse } from "./tapUntapTargetResponseHandlers.js";

// COUNTER_MOVEMENT / COUNTER_TARGET / COUNTER_DISTRIBUTION: counter move, add and divide prompts.
export {
  handleCounterDistributionResponse,
  handleCounterMovementResponse,
  handleCounterTargetResponse,
} from "./counterManipulationResponseHandlers.js";

// STATION_CREATURE_SELECTION: tap a creature to charge a Station permanent.
export { handleStationCreatureSelectionResponse } from "./stationCreatureSelectionResponseHandlers.js";

// LIFE_PAYMENT: pay-life prompt that resumes a pending cast.
export { handleLifePaymentResponse } from "./lifePaymentResponseHandlers.js";

// MANA_COLOR_SELECTION: any-color / distribution mana abilities and deferred activation costs.
export { handleManaColorSelectionResponse } from "./manaColorSelectionResponseHandlers.js";

// MANA_PAYMENT_CHOICE prefix: ward payment and sacrifice-unless-pay prompts.
export { tryHandleManaPaymentChoiceWardAndSacrificePrefix } from "./manaPaymentChoicePrefixHandlers.js";

// MANA_PAYMENT_CHOICE: activated-ability payment and its post-payment continuations.
export { tryHandleManaPaymentChoiceActivation } from "./manaPaymentChoiceActivationHandlers.js";

// MANA_PAYMENT_CHOICE tail: Phyrexian mana payment for an activated ability.
export { handleManaPaymentChoicePhyrexianActivation } from "./manaPaymentChoicePhyrexianHandlers.js";

// MODE_SELECTION prefix: modal/spree/tiered, Abundant Harvest, and overload cast resumes.
export { tryHandleModeSelectionCastResume } from "./modeSelectionCastResumeHandlers.js";

// MODE_SELECTION tail: legacy modal-spell resume plus mode-aware target recomputation.
export { handleModeSelectionGenericChoice } from "./modeSelectionGenericChoiceHandlers.js";

// Helpers used by the MODE_SELECTION target recomputation.
export {
  applyModeRestrictionsToSpec,
  buildModeChoiceOptionsFromTargetRefs,
  buildModeSpellSpecFromTargetRequirements,
} from "./modeSelectionTargetOptionBuilders.js";

// ADDITIONAL_COST_PAYMENT: discard/sacrifice/counter/reveal/behold/teamwork costs and cast restart.
export { handleAdditionalCostPaymentResponse } from "./additionalCostPaymentResponseHandlers.js";

// SQUAD_COST_PAYMENT: record the squad multiplier and resume the gated cast.
export { handleSquadCostPaymentResponse } from "./squadCostPaymentResponseHandlers.js";

// X_VALUE_SELECTION: spell-cast X, delayed up-to-N draw, and Blight X activation-cost choose-X.
export { handleXValueSelectionResponse } from "./xValueSelectionResponseHandlers.js";

// TRIGGER_ORDER: reorder simultaneous triggered abilities on the stack (CR 603.3b).
export { handleTriggerOrderResponse } from "./triggerOrderResponseHandlers.js";

// EXTORT_PAYMENT: pay {W/B} for Extort.
export { handleExtortPaymentResponse } from "./extortPaymentResponseHandlers.js";

// TARGET_SELECTION dispatcher (validation + remaining specialized branches).
export { handleTargetSelectionResponse } from "./targetSelectionResponseHandlers.js";

// MUTATE_TARGET_SELECTION: choose mutate target then resume the gated cast.
export { handleMutateTargetSelectionResponse } from "./mutateTargetSelectionResponseHandlers.js";

// Attack-tax payment that commits declare-attackers before the step is consumed.
export { processAttackCostPaymentBeforeStepComplete } from "./attackCostPaymentBeforeCompleteHandlers.js";

// Block-tax payment that commits declare-blockers before the step is consumed.
export { processBlockCostPaymentBeforeStepComplete } from "./blockCostPaymentBeforeCompleteHandlers.js";

// Grouped rules-choice resolution plus selection-id extractors.
export {
  extractResolutionSelectionId,
  extractResolutionSelectionIds,
  handleRulesChoiceGroupResponse,
} from "./rulesChoiceGroupResponseHandlers.js";

// Client mana-payment presentation hydration.
export {
  hydrateSpellPaymentPresentationFieldsForClient,
  mergeExtraAlternateCosts,
} from "./spellPaymentPresentationSanitizeUtils.js";

// Spell-cast payment resume after X / additional cost / mutate.
export {
  resumeAISpellCastAfterPayment,
  resumePlayerSpellCastAfterPayment,
  withTemporaryCastingPriorityForPaymentCompletion,
} from "./spellCastPaymentResumeHandlers.js";

// MAY_ABILITY / optional triggered-ability "you may" resume plus auto-decline drain.
export {
  extractFirstResolutionSelectionId,
  handleMayAbilityResponse,
  handleOptionalTriggeredAbilityChoiceResponse,
  isOptionalTriggeredEffectProgramStep,
  maybeDrainAutoDeclinedOptionalStackAfterDecline,
} from "./mayAbilityAndOptionalTriggerHandlers.js";

// OPTION_CHOICE dispatcher.
export { handleOptionChoiceResponse } from "./optionChoiceResponseHandlers.js";

// OPTION_CHOICE resume: may-reveal-hand / if-you-do four-zone named-copy win.
export { handleMayRevealHandWinIfOwnNamedChoice } from "./optionChoiceMayRevealHandWinHandlers.js";

// handleStepResponse core dispatcher.
export { handleStepResponse } from "./stepResponseHandlers.js";

// Socket registration (get/submit/cancel/preference/disconnect).
export { registerResolutionHandlers } from "./registerResolutionHandlers.js";

// Client step sanitizer and prompt emit.
export { sanitizeStepForClient } from "./sanitizeStepForClient.js";
export { emitResolutionStepPrompt } from "./emitResolutionStepPrompt.js";

// Timeout, cancel side-effects, and next-step emit.
export {
  applyCancelledResolutionStepSideEffects,
  clearScheduledResolutionStepTimeout,
  emitNextPendingResolutionStep,
  scheduleResolutionStepTimeoutForGame,
} from "./resolutionStepTimeoutAndCancelHandlers.js";

// Panglacial Wurm library-search cast.
export {
  getPanglacialCastableCards,
  getPanglacialCastCardId,
  restoreLibrarySearchStep,
} from "./panglacialSearchCastUtils.js";
export { handlePanglacialWurmSearchCast } from "./panglacialSearchCastHandlers.js";

// EffectProgram COLOR_CHOICE finalize after resume.
export { finalizeEffectProgramSpellColorChoiceAfterResume } from "./effectProgramSpellColorChoiceFinalize.js";

// Shared mutable IO handle for priority-pass timeout scheduling.
export { priorityResolutionHandlerState } from "./resolutionPriorityHandlerState.js";

// UPKEEP_SACRIFICE: edict / upkeep sacrifice a creature (optional source fallback + life-loss rider).
export { handleUpkeepSacrificeResponse } from "./upkeepSacrificeResponseHandlers.js";

// PLAYER_CHOICE: pick a player (legacy selection, control-change, dungeon, ETB chosen-player).
export { handlePlayerChoiceResponse } from "./playerChoiceResponseHandlers.js";

// TARGET_SELECTION branch: sacrifice permanents to pay a battlefield ability's activation cost.
export { handleSacrificeAbilityAsCostTargetSelection } from "./targetSelectionSacrificeAbilityCostHandlers.js";

// TARGET_SELECTION branches: remove-counters and return-to-hand activation costs.
export {
  handleRemoveCountersAbilityAsCostTargetSelection,
  handleReturnToHandAbilityAsCostTargetSelection,
} from "./targetSelectionActivationCostPaymentHandlers.js";

// TARGET_SELECTION branch: activated battlefield ability continuation (equip/fortify/reconfigure).
export { handleBattlefieldAbilityTargetSelection } from "./targetSelectionBattlefieldAbilityHandlers.js";

// TARGET_SELECTION branch: Lorwyn Eclipsed Blight N (-1/-1 counters as a cost).
export {
  BLIGHT_TARGET_SELECTION_STAGES,
  handleBlightKeywordTargetSelection,
} from "./targetSelectionBlightKeywordHandlers.js";

// TARGET_SELECTION post-pass: queue ward payment prompts (or counter) for warded targets.
export { maybeQueueWardPaymentPromptsForTargetSelection } from "./targetSelectionWardPromptHandlers.js";

// TARGET_SELECTION branches: sacrifice-then-benefit follow-ups (reflexive trigger, life/draw).
export {
  handleSacrificeAnotherPermanentForBenefitTargetSelection,
  handleSacrificeWhenYouDoTargetSelection,
} from "./targetSelectionSacrificeFollowupHandlers.js";

// TARGET_SELECTION branches: resume a cast-from-graveyard ability (sacrifice cost, spell targets).
export {
  handleGraveyardCastSacrificeAsCostTargetSelection,
  handleGraveyardSpellCastTargetSelection,
} from "./targetSelectionGraveyardCastHandlers.js";

// TARGET_SELECTION branches: scavenge counters and self/other become-a-copy actions.
export {
  handleBecomeCopyOfCreatureTargetSelection,
  handleScavengeTargetSelection,
} from "./targetSelectionScavengeAndCopyHandlers.js";

// TARGET_SELECTION `step.action` chain: immediate battlefield actions.
export { tryHandleTargetSelectionImmediateBattlefieldAction } from "./targetSelectionImmediateBattlefieldActions.js";

// TARGET_SELECTION `step.action` chain: graveyard card moves (hand/battlefield/exile).
export { tryHandleTargetSelectionGraveyardCardAction } from "./targetSelectionGraveyardCardActions.js";

// TARGET_SELECTION branches: tap-creatures-as-cost graveyard return and Equipment attachment.
export {
  handleAttachEquipmentSelectEquipmentTargetSelection,
  handleTapCreaturesCostTargetSelection,
} from "./targetSelectionTapCostAndAttachHandlers.js";

// TARGET_SELECTION branches: SOLDIER Military Program counters and planeswalker loyalty abilities.
export {
  handlePlaneswalkerAbilityTargetSelection,
  handleSoldierProgramCounterTargetSelection,
} from "./targetSelectionPlaneswalkerAndSoldierHandlers.js";

// TARGET_SELECTION tail: auto-unignore targeted permanents, then request spell payment (CR 601.2h).
export {
  applyAutoUnignoreForTargetedPermanents,
  handleSpellCastPaymentTargetSelection,
} from "./targetSelectionSpellCastPaymentHandlers.js";

// TARGET_SELECTION branches: Crew (Vehicle) and Enlist (attacks trigger) creature choices.
export {
  handleEnlistChoiceTargetSelection,
  tryHandleCrewAbilityTargetSelection,
} from "./targetSelectionCrewAndEnlistHandlers.js";

// TARGET_SELECTION branches: dungeon room sacrifice cost and dungeon room creature effects.
export {
  handleDungeonRoomSacrificePayment,
  handleDungeonTargetCreatureEffect,
} from "./targetSelectionDungeonRoomHandlers.js";

// TARGET_SELECTION branches: exert reward targets and copied spell/ability retargeting.
export {
  handleExertTargetChoiceTargetSelection,
  handleRetargetAbilityCopyTargetSelection,
  handleRetargetSpellCopyTargetSelection,
} from "./targetSelectionExertAndCopyRetargetHandlers.js";

// TARGET_SELECTION branches: targets for a triggered ability and for damage-received triggers.
export {
  handleDamageReceivedTriggerTargetSelection,
  handleTargetedTriggeredAbilityTargetSelection,
} from "./targetSelectionTriggeredAbilityTargetHandlers.js";

// TARGET_SELECTION branches applied on the spot: Divine Reckoning survivors, Grave Pact style
// sacrifice selection, and stored opponent selections.
export {
  handleDivineReckoningChoiceTargetSelection,
  handleOpponentSelectionTargetSelection,
  handleSacrificeSelectionTargetSelection,
} from "./targetSelectionNonStackChoiceHandlers.js";

// TARGET_SELECTION cancellation pass: ward declines, Blight N stages, aborted activation costs.
export { handleCancelledTargetSelectionResponse } from "./targetSelectionCancellationHandlers.js";

// TARGET_SELECTION Oracle IR prompts: any-player-may payment and library-chaos exchange targets.
export {
  handleOracleIrAnyPlayerMayPaymentSelection,
  handleOracleIrLibraryChaosTargetSelection,
} from "./targetSelectionOracleIrPromptHandlers.js";

// OPTION_CHOICE selection-id readers shared by extracted option-choice handlers.
export {
  extractOptionChoiceSelectionId,
  extractOptionChoiceSelectionIds,
} from "./resolutionOptionChoiceSelectionIds.js";

// OPTION_CHOICE land-entry prompts: shock, reveal, land-sacrifice and discard-a-land replacements.
export {
  handleLandWouldEnterSacrificeChoice,
  handleMoxDiamondChoice,
  handleRevealLandChoice,
  handleShockLandChoice,
} from "./optionChoiceLandEntryReplacementHandlers.js";

// OPTION_CHOICE ward prompt: pay the ward cost (mana, life, discard, sacrifice) or be countered.
export { handleWardPaymentOptionChoice } from "./optionChoiceWardPaymentHandlers.js";

// OPTION_CHOICE pay-or-else prompts: sacrifice-unless-pay, Force of Will pitch, opponent may pay.
export {
  handleForceOfWillExileChoice,
  handleOpponentMayPayChoice,
  handleSacrificeUnlessPayChoice,
} from "./optionChoicePayOrElseHandlers.js";

// OPTION_CHOICE "play / cast that card from your graveyard" prompts.
export {
  handleCastFromGraveyardPromptChoice,
  handlePlayFromGraveyardPromptChoice,
} from "./optionChoiceCastFromGraveyardPrompts.js";

// OPTION_CHOICE "cast that card from exile" prompts, including Dance with Calamity's sequence.
export {
  handleCastFromExilePromptChoice,
  handleDanceWithCalamityCastPrompt,
  type CastFromExilePromptHelpers,
} from "./optionChoiceCastFromExilePrompts.js";

// Reflexive "when you do" prompts that move cards and push the reflexive trigger in one pass.
export {
  handleReflexiveBoundGraveyardSelfExileWhenYouDo,
  handleReflexiveExileToOwnersGraveyardWhenYouDo,
} from "./optionChoiceReflexiveExileWhenYouDoHandlers.js";

// Reflexive "when you do" ask prompts that only queue the follow-up selection step.
export {
  handleReflexiveDiscardWhenYouDo,
  handleReflexiveGraveyardExileWhenYouDo,
  handleSacrificeWhenYouDoAskChoice,
} from "./optionChoiceReflexiveWhenYouDoQueueHandlers.js";

// OPTION_CHOICE prompts a dungeon room asks after it has been entered.
export {
  handleDungeonRoomFreeCastFromHandChoice,
  handleDungeonRoomPenaltyChoice,
  handleDungeonRoomThroneChoice,
} from "./optionChoiceDungeonRoomPrompts.js";

// AI auto-answers for keyword-ability prompts (fabricate, exploit, backup, enlist, haunt, ...).
export { buildAiKeywordChoiceStepResponse } from "./aiKeywordChoiceStepResponses.js";

// AI auto-answers for zone card-selection prompts (library search, scry, surveil, discard, ...).
export { buildAiZoneSelectionStepResponse } from "./aiZoneSelectionStepResponses.js";

// AI auto-answers for one-shot choice prompts (color, vote, clash, proliferate, riot, ...).
export { buildAiSimpleChoiceStepResponse } from "./aiSimpleChoiceStepResponses.js";

// AI auto-answers for cost/decision prompts (station, life payment, explore, mode selection, ...).
export { buildAiCostAndExploreStepResponse } from "./aiCostAndExploreStepResponses.js";

// AI auto-answers for X / mana-color / hand / draft prompts (X value, hand to bottom, hideaway, ...).
export { buildAiHandAndDraftStepResponse } from "./aiHandAndDraftStepResponses.js";

// AI auto-answers for battlefield target prompts (fight, tap/untap, counters, mutate, ...).
export {
  buildAiTargetSelectionStepResponse,
  type AiTargetSelectionStepHelpers,
} from "./aiTargetSelectionStepResponses.js";

// Pre-game hand steps: opening-hand battlefield cards and the London mulligan bottoming.
export {
  handleHandToBottomResponse,
  handleOpeningHandActionsResponse,
  type StepResponseExit,
} from "./preGameHandStepResponseHandlers.js";

// MANA_PAYMENT_CHOICE for a spell being cast: cancel, graveyard cast, mutate detour, or finish.
export {
  handleSpellPaymentChoiceResponse,
  type SpellPaymentChoiceHelpers,
} from "./manaPaymentSpellCastResponseHandlers.js";

// ETB "choose an ability" pick and the multi-player counter-placement round.
export {
  handleCounterPlacementTriggerChoice,
  handleEtbPermanentOptionChoice,
} from "./optionChoiceEtbAndCounterPlacementPrompts.js";

// step.action keyed OPTION_CHOICE branches: tap-or-untap, Mox Diamond off the stack.
export {
  handleMoxDiamondStackChoice,
  handleTapOrUntapDecision,
} from "./optionChoiceBoardActionPrompts.js";

// OPTION_CHOICE prompts deciding what happens to a card in exile: play permission, rebound cast.
export {
  handleGrantPlayableFromExileChoice,
  handleReboundCastChoice,
} from "./optionChoiceExilePlayPermissionPrompts.js";

// OPTION_CHOICE prompts for optional discard-then-draw and the repeated mana-color picker.
export {
  handleChooseManaColorsChoice,
  handleOptionalDiscardThenDrawChoice,
} from "./optionChoiceDiscardAndManaColorPrompts.js";

// OPTION_CHOICE prompts whose selection is a player who then receives the real prompt.
export {
  handleChoosePlayerForLookedAtCardsChoice,
  handleChoosePlayerForTwoPileSplitChoice,
} from "./optionChoiceChoosePlayerPrompts.js";

// OPTION_CHOICE prompts that pick how a cost gets paid: blight-or-pay, preferred-or-fallback discard.
export {
  handleChooseDiscardPlanChoice,
  handleSpellAdditionalCostBlightOrPayChoice,
} from "./optionChoiceCostPlanPrompts.js";

// OPTION_CHOICE prompts that pick one of the player's own cards or permanents.
export {
  handleAttachEquipmentToPermanentChoice,
  handleMoveChosenHandCardToLibraryChoice,
  handleSacrificeAnotherPermanentForBenefitAskChoice,
} from "./optionChoicePermanentAndHandCardPrompts.js";

// OPTION_CHOICE prompts about a set of shown cards: destination picking, pay-X-to-look, pile picking.
export {
  handleChooseLookedAtCardsDestinationChoice,
  handleChoosePileFromSplitChoice,
  handlePayManaToLookAndChooseCardChoice,
} from "./optionChoiceLookedAtCardsAndPileHandlers.js";

// OPTION_CHOICE prompts around copying a spell or ability, and retargeting the copy.
export {
  handleResolvedSpellCopyChoice,
  handleRetargetAbilityCopyChoice,
  handleRetargetSpellCopyChoice,
} from "./optionChoiceSpellCopyPrompts.js";

// Venture prompts plus the shared room-effect applier (honors the room-ability doubler).
export {
  applyDungeonRoomEffectsWithDoubler,
  handleVentureChooseDungeonChoice,
  handleVentureChooseRoomChoice,
  handleVentureIntoDungeonChoice,
} from "./optionChoiceVentureDungeonHandlers.js";

// Pending-cast payment prompt builders shared by cast/additional-cost flows (not a step handler).
export {
  buildPendingCastPaymentManaCost,
  buildPendingCastPaymentStepCostFields,
  buildSpellPaymentPresentationFields,
  emitPendingCastPaymentIfNeeded,
  ensurePendingCastCostMetadata,
} from "./resolutionPendingCastPaymentPrompt.js";

// Counter-removal cost selection parsing/validation shared with pre-complete validation.
export {
  validateCounterRemovalPaymentSelection,
  type NormalizedCounterRemovalPayment,
} from "./resolutionCounterRemovalPaymentSelection.js";

// Shared mana-payment appliers used by every resolution payment prompt (not a step handler).
export {
  applySelectedManaPaymentForResolutionCost,
  applyWardManaPaymentSelection,
  extractResolutionPaymentItems,
  validateWardManaPaymentSelection,
} from "./resolutionManaPaymentApplication.js";

// "another / different target" heuristics shared by pre-complete validation, sanitizeStepForClient
// and the AI target picker (not a step handler).
export {
  getFilteredValidTargetsForStep,
  getPreviouslyChosenTargetsForSource,
  stepIndicatesDifferentTarget,
} from "./resolutionTargetSelectionDistinctTargetUtils.js";

// STEP_ADDED auto-answer gate: AI seats only. Human APNAP choices wait for click or timeout.
export { shouldAutoResolveResolutionStep } from "./resolutionAutoResolveGate.js";