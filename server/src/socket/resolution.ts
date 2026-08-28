/**
 * socket/resolution.ts
 * 
 * Socket handlers for the unified Resolution System.
 * Handles client interaction with the ResolutionQueueManager.
 */

import type { Server, Socket } from "socket.io";
import { resolveGroupedPermanentRef } from './tokenGroupResolve.js';
import { appendEvent } from "../db/index.js";
import { attachZoneHandSnapshotToStep } from "../state/modules/promptZoneHandSnapshot.js";
import { 
  ResolutionQueueManager, 
  ResolutionQueueEvent,
  ResolutionStepStatus,
  ResolutionStepType,
  createResolutionStep,
  type ResolutionStep,
  type ResolutionStepResponse,
  type TargetSelectionStep,
  bindCanonicalResolutionQueueGameId,
  contextHasBlockingNonPaymentResolutionSteps,
  contextHasPendingResolutionSteps,
} from "../state/resolution/index.js";
import { inferResolutionStepMandatory } from "../state/resolution/mandatoryInference.js";
import {
  ensureGame,
  broadcastGame,
  getPlayerName,
  emitToPlayer,
  getEffectivePower,
  getEffectiveToughness,
  appendGameEvent,
  persistAndResolveTopOfStack,
  parseManaCost,
  getOrInitManaPool,
  calculateTotalAvailableMana,
  validateManaPayment,
  consumeManaFromPool,
  validateAndConsumeManaCostFromPool,
  broadcastManaPoolUpdate,
  calculateManaProduction,
  resolveActivatedAbilityLineById,
  clearHumanAutoPassPauseOnAction,
  getMaxGenericManaAvailable,
  payGenericManaWithAvailableSources,
  refundGenericManaPayment,
  getFloatingPaymentPoolColorKey,
  buildActivatedAbilityRestrictedManaPurpose,
  buildManaTotalsIncludingEligibleRestricted,
  consumeManaFromPoolForPurpose,
  canUseRestrictedMana,
  type RestrictedManaSpendPurpose,
} from "./util.js";
import { syncDerivedContinuousEffects } from "../state/modules/staticEffectSpec.js";
import { isLoopShortcutBroadcastSuppressed } from "./loopShortcutSustain.js";
import { validateGroupedTargetSelections, validatePerOpponentTargetSelections } from "./perOpponentTargetValidation.js";
import { checkAndPromptOpeningHandActions, getOpeningHandBattlefieldCounters, isOpeningHandBattlefieldCard } from "./opening-hand.js";
import { executeDeclareAttackers } from "./combat.js";
import { cardManaValue, uid, calculateVariablePT, validateLifePayment } from "../state/utils.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { filterLibraryCardsForSearch } from "./library-search.js";
import {
  chooseAIHideawayCardId,
  chooseAIKynaiosChoiceSelection,
  chooseAIPlayerChoiceId,
  chooseAIReturnControlledPermanentId,
  chooseAIScrySelection,
  chooseAIModeSelectionsForStep,
  chooseAIOptionSelectionsForStep,
  chooseAIUpkeepSacrificeSelection,
  handleBounceLandETB,
  chooseAICardNameSelection,
  chooseAILibrarySearchCards,
  chooseAILibrarySearchResponse,
  chooseAIGraveyardSelectionIds,
  chooseAIManaColorForActivation,
  chooseAIXValueSelection,
  chooseAISpellPaymentSelections,
  chooseAITargetSelectionsForChoiceStep,
  isAIPlayer,
  rememberAIFailedSpellCast,
} from "./ai.js";
import type { PlayerID } from "../../../shared/src/types.js";
import { isValidPBudgetSelection } from "../../../shared/src/modeSelectionPBudget.js";
import {
  NO_UNTIL_TARGETS_CHANGE_REQUEST,
  buildNoUntilTargetsChangeValue,
  fingerprintArtifactEnchantmentTargets,
  parseNoUntilTargetsChangeFingerprint,
} from "../../../shared/src/mayAutoPreference.js";
import {
  buildOptionalEffectKey,
  findMayAutoPreferenceEntry,
} from "../../../shared/src/optionalEffectKey.js";
import { getSavedMayAbilityTriggerDecision } from "./trigger-shortcuts.js";
import { wouldAutoDeclineOptionalTriggeredAbility } from "../state/modules/stackResolveTriggeredAbilityOptionalUtils.js";
import { isShockLand } from "./land-helpers.js";
import type { GameContext } from "../state/context.js";
import { handleKynaiosChoiceResponse as handleKynaiosChoiceResponseBatched } from "../state/resolution/handlers/kynaiosChoice.js";
import { permanentHasCreatureTypeNow } from "../state/creatureTypeNow.js";
import { applyDredgeDrawReplacementChoice, applyZursWeirdingOpponentChoice, drawCards as drawCardsFromZones, movePermanentToHand } from "../state/modules/zones.js";
import { dispatchDamageReceivedTrigger, processDamageReceivedTriggers, resolveDamageTrigger, type DamageTriggerInfo } from "../state/modules/triggers/damage-received.js";
import { getDiscardTriggers } from "../state/modules/triggers/discard.js";
import { orderTriggersByAPNAP } from "../state/modules/triggers/ordering.js";
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from "../state/modules/triggers/target-metadata.js";
import { queueLibraryShuffleTriggers } from "../state/modules/triggers/shuffle.js";
import { queueLibrarySearchTriggers } from "../state/modules/triggers/search.js";
import { queueLifePaymentTriggers } from "../state/modules/triggers/pay-life.js";
import { getTokenImageUrls } from "../services/tokens.js";
import { normalizeCardName } from "../state/modules/chosen-name-restrictions.js";
import {
  applyDivineReckoningBatchResult,
  applyPrisonersDilemmaBatchResult,
  clearDivineReckoningChoiceBatch,
  clearPrisonersDilemmaChoiceBatch,
  recordDivineReckoningChoice,
  recordPrisonersDilemmaChoice,
} from "../state/modules/spellLegacyChoiceBatchUtils.js";
import { returnExiledCardToBattlefield, scheduleExiledCardReturnToBattlefield } from "../state/modules/executeSpellEffect.js";
import { storeHideawayExiledCard } from "../state/modules/hideawayExile.js";
import { inferTriggeredAbilityTargetMetadata } from "../state/modules/inferTriggeredAbilityTargetMetadata.js";
import {
  extractControlledExploitTriggeredEffects,
  extractSelfExploitTriggeredEffects,
  pushSingleExploitRewardTrigger,
} from "../state/modules/exploitKeywordTriggerUtils.js";
import { executeTriggerEffect } from "../state/modules/stackExecuteTriggerEffectUtils.js";
import { resolveTriggerStackItemEffectText } from "../state/modules/stackResolveTriggeredAbilityOrchestratorUtils.js";
import { applyPermanentBecomeCopyOfTargetPermanent } from "../state/modules/permanent-copy.js";
import { applyTriggeredReanimationEntryRiders } from "../state/modules/triggerReanimationRiders.js";
import { queueSelfETBTriggersForPermanent } from "../state/modules/triggerEtbEntryEffects.js";
import { triggerETBEffectsForPermanent } from "../state/modules/triggerEtbPermanentEffects.js";
import { processFaceUpTriggers } from "../state/modules/triggerEmissionFamilyUtils.js";
import { applyHauntExileToTarget } from "../state/modules/hauntKeywordUtils.js";
import { applyMyriadTokenCopies } from "../state/modules/triggerMyriadTokenUtils.js";
import { queueTributeChoiceOnEntry } from "../state/modules/triggerTributeChoiceUtils.js";
import {
  buildPaymentCostAdjustmentPayload,
  creatureHasHaste,
  formatManaCostWithCostAdjustment,
  getSpellModeAdditionalCost,
  handlePlayLandRequest,
  registerGameActions,
  requestCastSpellForSocket,
  resolveEffectiveSpellBaseManaCost,
  type CostReductionMetadata,
  type PendingCastCostMetadata,
} from "./game-actions.js";
import { buildOraclePromptContext, getOracleTextFromResolutionStep } from "../utils/oraclePromptContext.js";
import { cleanupCardLeavingExile, removePlayableFromExileForCard, stripPlayableFromExileTags } from "../state/modules/playable-from-exile.js";
import { buildDurablePlayableFromExilePermission, upsertDurablePermission } from "../state/modules/durable-permissions.js";
import { destroyPermanent, movePermanentToExile, removePermanent, resolveLegendRuleChoice } from "../state/modules/counters_tokens.js";
import { trackCountersPlacedThisTurn } from "../state/modules/counters_tokens.js";
import { updateCounters } from "../state/modules/counters_tokens.js";
import { transformPermanentToFace } from "../state/modules/day-night.js";
import { registerLinkedExile } from "../state/modules/triggers/linked-exile.js";
import { queueExiledFromBattlefieldTriggers } from "../state/modules/triggers/zone-change.js";
import { validateCounterRemovalPaymentSelection, type NormalizedCounterRemovalPayment } from "./resolution-handlers/resolutionCounterRemovalPaymentSelection.js";
import { BLIGHT_TARGET_SELECTION_STAGES } from "./resolution-handlers/targetSelectionBlightKeywordHandlers.js";
import {
  buildPendingCastPaymentManaCost,
  buildPendingCastPaymentStepCostFields,
  buildSpellPaymentPresentationFields,
  emitPendingCastPaymentIfNeeded,
  ensurePendingCastCostMetadata,
} from "./resolution-handlers/resolutionPendingCastPaymentPrompt.js";
import { recordCardLeftGraveyardThisTurn, recordCardPutIntoGraveyardThisTurn } from "../state/modules/turn-tracking.js";
import { canPermanentBeTargetedByPlayer, categorizeSpell, evaluateTargeting, matchesGraveyardCardTargetType as matchesSharedGraveyardCardTargetType, parseTargetRequirements, permanentsShareCardType, selectionRequiresSharedCardType, type SpellSpec } from "../rules-engine/targeting";
import { counterStackItem } from "../state/modules/stack-mechanics.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../state/modules/graveyardEntryUtils.js";
import { resolveLandWouldEnterSacrificeChoice, resolveWouldEnterDiscardLandChoice } from "../state/modules/land-would-enter-replacement.js";
import { handleDeclinedPlayerSelection } from "./player-selection.js";
import {
  executeLibraryChaosExchange,
  permanentMatchesLibraryChaosTarget,
  queueLibraryChaosCastOffers,
  type LibraryChaosExchangeStep,
} from "../state/modules/oracleIrLibraryChaosExchange.js";
import { buildResolutionEventDataFromGameState, buildTriggeredAbilityEventDataFromChoices, executeTriggeredAbilityEffectWithOracleIR } from "../../../rules-engine/src/triggeredAbilities.js";
import { queueTapTriggersForTappedPermanents } from "../state/modules/tap-trigger-queue.js";
import { queueBecomesUntappedTriggers } from "../state/modules/triggers/tap-untap.js";
import { serializeAbilityActivatedTriggeredStackItem, triggerAbilityActivatedTriggers } from "../state/modules/triggers/ability-activated.js";
import {
  extractStackItemTargetIds,
  persistTargetedTriggeredStackItems,
  triggerPermanentTargetedTriggersFromAbility,
} from "../state/modules/triggers/targeted.js";
import { clearMayCallback, clearMayCallbacks, consumeMayCallback, queueMayAbilityStep } from './may-ability-prompts.js';
export { clearMayCallback, clearMayCallbacks, queueMayAbilityStep } from './may-ability-prompts.js';
import { consumeOptionalPaymentCallback, getOptionalPaymentValidationFailure, isOptionalPaymentPayChoice, isOptionalPaymentPromptStep, queueOptionalPaymentStep, queueShockLandPaymentStep } from './optional-payment-prompts.js';
import { resolveOracleIrOptionalPaymentPromptFromResolution, resolveOracleIrAnyPlayerMayPaymentSelectionFromResolution, maybeApplyOracleIrChoiceStepFromResolution, maybeResumeOracleIRStepsAfterResolution, processPendingOracleIrCompoundResumeOnContext, syncAllOracleIRPlayerZonesAfterResolution } from '../state/modules/oracleIrServerZoneSync.js';
import { refreshCounterPlacementResolutionStepForClient } from '../state/modules/triggerCounterPlacementPromptUtils.js';
import { refreshKynaiosLandPlayResolutionStepForClient } from '../state/modules/triggerLandPlayPromptUtils.js';
import { tryApplyStationChargeCountersViaOracleIR } from '../state/modules/oracleIrAbilityExecution.js';
import { readOracleIrLedgerPersistFields, readOracleIrCompoundResumePersistFields } from '../state/modules/oracleIrTransitionPipeline.js';
import { maybeResumeDeferredOracleIrStackSpellOnGame } from '../state/modules/oracleIrDeferredStackFinalize.js';
import { applyJoinForcesPaidManaPowerPump } from '../state/modules/joinForcesResolutionQueue.js';
import { persistBattlefieldPermanentPatchAfterMutation } from '../state/effects/battlefieldPermanentReplayPersistence.js';
import { cardMatchesReflexiveGraveyardExileType, collectOpponentOwnedExileCardTargets, consumeReflexiveManaAmountFromPool, formatReflexiveExileToOwnersGraveyardLabel, formatReflexiveFixedPaymentLabel, formatReflexiveGraveyardExileLabel, formatReflexiveManaAmount, getAvailableReflexiveManaAmountFromPool, materializeReflexiveFollowupText, materializeReflexiveSourceText, parseReflexivePaymentChoiceAmount, permanentMatchesReflexiveSacrificeType } from '../state/modules/reflexive-triggers.js';
import { advanceStepPersistingEvent } from "./step-advance.js";
import { tryAutoStartGameFromPreGame } from "./pregame-auto-start.js";
import { lookupLocalCardByNameSync } from "../services/localCardLookup.js";
import { getDominantCreatureType } from "./creature-type.js";
import {
  detectManaModifiers,
  getCreatureCountManaAmount,
  getDevotionManaAmount,
  getExtraManaProduction,
  getManaMultiplier,
  parseManaSpendRestrictionFromOracle,
} from "../state/modules/mana-abilities.js";
import { buildAnyCombinationManaSelectionFields, buildManaProductionColorSelectionFields, isCombinationOrAnyColorManaField, resolveAllowedColorsForCombinationMana } from "../state/modules/manaColorSelectionStepUtils.js";
import { continueCastFromGraveyardAbility, queueCounterTargetStepForBattlefieldAbility, resolveManaAbilityActivationShape } from "./interaction.js";
import { pushWheneverYouExertTriggersOntoStack } from "./exert-triggers.js";

import {
  extractResolutionChoiceId,
  appendKeywordPromptResolveEvent,
  emitKeywordChoiceChat,
  getResolutionSourcePermanentSnapshot,
  buildTriggeredAbilitySourceContext,
  pushExertTriggeredAbilityOntoStack,
  matchesRequiredTypeWords,
  buildExertTriggeredGraveyardSelectionData,
  handleRiotChoiceResponse,
  handleUnleashChoiceResponse,
  handleFabricateChoiceResponse,
  handleTributeChoiceResponse,
  handleMentorTargetResponse,
  handleExploitChoiceResponse,
  handleModularChoiceResponse,
  handleSoulshiftTargetResponse,
  handleHauntTargetResponse,
} from "./resolutionKeywordChoiceHandlers.js";
import {
  serializeTriggeredTargetMetadata,
  queueDiscardTriggeredAbilities,
  queueDiscardTriggeredGraveyardCastAbilities,
  inferFollowupTargetMetadata,
} from "./resolutionDiscardTriggerUtils.js";
import {
  tryCounterByWard,
  emitWardCounterOutcome,
} from "./resolutionWardUtils.js";
import {
  markPermanentEnteredFromZone,
  finalizeBattlefieldAbilitySelfExertCost,
  triggeredSourceExilesSpellCastThisWay,
  getNextEndStepFireTurnNumberForResolution,
  getNextUpkeepNotBeforeTurnNumberForResolution,
} from "./resolutionGraveyardSelectionHelperUtils.js";
import {
  fireBattlefieldAbilityActivatedTriggers,
  battlefieldAbilityStackReplayEvidence,
  buildActivatedAbilityValidTargets,
} from "./resolutionActivatedAbilityTargetingUtils.js";
import {
  type ResolutionPaymentItem as ExtractedResolutionPaymentItem,
  type ResolutionManaPaymentPersistOptions,
  persistResolutionPaymentManaMutations,
  resolutionManaSourceSelfSacrifices,
  resolutionPaymentActivationCostHasUnsupportedAdditionalCosts,
  getSupportedResolutionActivationManaCost,
  cloneGameForResolutionPaymentValidation,
  snapshotResolutionManaPool,
  createEmptyResolutionManaTotals,
  getResolutionPaymentProducedManaTotals,
  addResolutionManaTotals,
  consumeExplicitSelectedResolutionMana,
  calculateResolutionManaPoolDelta,
  MANA_POOL_KEY_BY_SYMBOL as EXTRACTED_MANA_POOL_KEY_BY_SYMBOL,
} from "./resolutionPaymentManaUtils.js";
export { persistResolutionPaymentManaMutations };
import { buildAiKeywordChoiceStepResponse } from "./resolution-handlers/aiKeywordChoiceStepResponses.js";
import { buildAiZoneSelectionStepResponse } from "./resolution-handlers/aiZoneSelectionStepResponses.js";
import { buildAiSimpleChoiceStepResponse } from "./resolution-handlers/aiSimpleChoiceStepResponses.js";
import { buildAiCostAndExploreStepResponse } from "./resolution-handlers/aiCostAndExploreStepResponses.js";
import { buildAiTargetSelectionStepResponse } from "./resolution-handlers/aiTargetSelectionStepResponses.js";
import { buildAiHandAndDraftStepResponse } from "./resolution-handlers/aiHandAndDraftStepResponses.js";
import { shouldAutoResolveResolutionStep } from "./resolution-handlers/resolutionAutoResolveGate.js";
import {
  applySelectedManaPaymentForResolutionCost,
  applyWardManaPaymentSelection,
  extractResolutionPaymentItems,
  validateWardManaPaymentSelection,
} from "./resolution-handlers/resolutionManaPaymentApplication.js";
import {
  cloneCascadeZoneCard,
  cloneCascadeLibrary,
  cloneLibraryStateForEvent,
  cloneZoneCardsForEvent,
  cloneExileStateForEvent,
} from "./resolutionCloneQueuedPromptUtils.js";
import {
  processPendingCascades,
  processPendingScry,
  processPendingSurveil,
  processPendingOracleIrCompoundResume,
  processPendingProliferate,
  processPendingPonder,
  processPendingBottomOrder,
  processPendingLimDulsVault,
  processPendingDanceWithCalamity,
  completeDanceWithCalamityDeferredAdvance,
  advanceDanceWithCalamityCastSequence,
  upsertOneShotCastFromExilePromptPermission,
} from "./resolutionProcessPendingHandlers.js";
export {
  processPendingCascades,
  processPendingScry,
  processPendingSurveil,
  processPendingOracleIrCompoundResume,
  processPendingProliferate,
  processPendingPonder,
  processPendingBottomOrder,
  processPendingLimDulsVault,
  processPendingDanceWithCalamity,
  completeDanceWithCalamityDeferredAdvance,
} from "./resolutionProcessPendingHandlers.js";
import {
  handleLibrarySearchResponse,
  isTrueLibrarySearchStep,
} from "./resolutionLibrarySearchHandlers.js";
import {
  oracleIrTopLibraryChoiceResumeApplied,
} from "./resolutionLibrarySearchOracleIrResumeUtils.js";
import { createLibrarySearchStep } from "./resolutionLibrarySearchStepUtils.js";
import { getResolutionHandlerDeps } from "./resolutionHandlerDeps.js";
import {
  extractFirstResolutionSelectionId,
  handleMayAbilityResponse,
  handleOptionalTriggeredAbilityChoiceResponse,
  isOptionalTriggeredEffectProgramStep,
  maybeDrainAutoDeclinedOptionalStackAfterDecline,
} from "./resolution-handlers/mayAbilityAndOptionalTriggerHandlers.js";
import { resumePlayerSpellCastAfterPayment } from "./resolution-handlers/spellCastPaymentResumeHandlers.js";
import { handleTargetSelectionResponse } from "./resolution-handlers/targetSelectionResponseHandlers.js";
import { processAttackCostPaymentBeforeStepComplete } from "./resolution-handlers/attackCostPaymentBeforeCompleteHandlers.js";
import { handleRulesChoiceGroupResponse } from "./resolution-handlers/rulesChoiceGroupResponseHandlers.js";
import { hydrateSpellPaymentPresentationFieldsForClient } from "./resolution-handlers/spellPaymentPresentationSanitizeUtils.js";
import {
  getPanglacialCastableCards,
  getPanglacialCastCardId,
  restoreLibrarySearchStep,
} from "./resolution-handlers/panglacialSearchCastUtils.js";
import { sanitizeStepForClient } from "./resolution-handlers/sanitizeStepForClient.js";
export { sanitizeStepForClient };
import { handleOptionChoiceResponse } from "./resolution-handlers/optionChoiceResponseHandlers.js";
import { priorityResolutionHandlerState } from "./resolution-handlers/resolutionPriorityHandlerState.js";
import {
  applyCancelledResolutionStepSideEffects,
  clearScheduledResolutionStepTimeout,
  emitNextPendingResolutionStep,
  scheduleResolutionStepTimeoutForGame,
} from "./resolution-handlers/resolutionStepTimeoutAndCancelHandlers.js";
import { handleStepResponse } from "./resolution-handlers/stepResponseHandlers.js";
import { emitResolutionStepPrompt } from "./resolution-handlers/emitResolutionStepPrompt.js";
export { emitResolutionStepPrompt };
import { registerResolutionHandlers } from "./resolution-handlers/registerResolutionHandlers.js";
export { registerResolutionHandlers };
import {
  handleBottomOrderResponse,
  handleClashResponse,
  handleFatesealResponse,
  handlePonderEffectResponse,
  handleSequentialOracleIrPileSplitResponse,
  handleTwoPileSplitResponse,
} from "./resolutionLibraryLookResponseHandlers.js";
import { handleModalChoiceResponse, handleSoldierProgramChoice } from "./resolutionModalChoiceResponseHandlers.js";
import { handleCommanderZoneResponse } from "./resolutionCommanderZoneResponseHandlers.js";
export {
  handleBottomOrderResponse,
  handleClashResponse,
  handleFatesealResponse,
  handlePonderEffectResponse,
  handleSequentialOracleIrPileSplitResponse,
  handleTwoPileSplitResponse,
} from "./resolutionLibraryLookResponseHandlers.js";
import { getTypeSpecificFields } from "./resolutionStepTypeSpecificFieldsUtils.js";
import {
  appendCastSpellContinuationEvent,
  createForwardingGameActionSocket,
  restartPlayerCastRequest,
} from "./resolutionSyntheticCastSocketUtils.js";
import { validateExtractedStepTypesBeforeComplete } from "./resolutionRegisterPreCompleteValidationForExtractedSteps.js";
import {
  validateManaColorSelectionBeforeComplete,
  validatePhyrexianManaPaymentBeforeComplete,
  validateStepResponseClusterStepsBeforeComplete,
} from "./resolutionRegisterPreCompleteValidationForStepResponseClusters.js";
import { validateChoicePromptStepsBeforeComplete } from "./resolutionRegisterPreCompleteValidationForChoicePromptSteps.js";
import { validateCostPaymentStepsBeforeComplete } from "./resolutionRegisterPreCompleteValidationForCostPaymentSteps.js";
import {
  validateManaPaymentChoiceStepBeforeComplete,
  validateTapCostExtortAndExploitStepsBeforeComplete,
} from "./resolutionRegisterPreCompleteValidationForManaAndSacrificeSteps.js";
import { validateTargetSelectionStepsBeforeComplete } from "./resolutionRegisterPreCompleteValidationForTargetSelectionSteps.js";
import { validateActivationCostStepsBeforeComplete } from "./resolutionRegisterPreCompleteValidationForActivationCostSteps.js";
import { validateFaceDownAndKeywordStepsBeforeComplete } from "./resolutionRegisterPreCompleteValidationForFaceDownAndKeywordSteps.js";
import { getFilteredValidTargetsForStep } from "./resolution-handlers/resolutionTargetSelectionDistinctTargetUtils.js";
import { validateModeTriggerAndOpeningHandStepsBeforeComplete } from "./resolutionRegisterPreCompleteValidationForModeAndTriggerSteps.js";
import {
  validateOptionChoicePayCostPromptsBeforeComplete,
  validateOptionChoiceSelectionShapeBeforeComplete,
} from "./resolutionRegisterPreCompleteValidationForOptionChoiceSteps.js";
import {
  validateGraveyardSelectionBeforeComplete,
  validateHandSelectionStepsBeforeComplete,
  validateLibrarySearchBeforeComplete,
} from "./resolutionRegisterPreCompleteValidationForZoneSelectionSteps.js";
import { getValidMutateTargets, parseMadnessCost, parseMutateCost, buildCommanderFreeCastPaymentExtras } from "../state/modules/alternate-costs.js";
import {
  applyPowerUpDiscountsToActivationManaCost,
  maybeMarkPowerUpAbilityUsedFromActivationContext,
} from "../state/modules/marvelMechanicsHelpers.js";
import { isActivatedManaAbilityText } from "../state/modules/ability-cost-adjustments.js";
import { applyGraveyardPermissionEffectsFromText } from "../state/modules/graveyard-permissions.js";
import { createEffectProgramChoiceResponse, readEffectProgramQueueMetadata, restoreAllPendingEffectProgramRuntimes, restoreEffectProgramRuntimeForPendingStep, resumeEffectProgramResolution, persistEffectProgramChoiceResolutionEvent, drainPendingOptionalAutoChoices } from "../state/effects/index.js";

// ResolutionPaymentItem -> resolutionPaymentManaUtils (imported as ExtractedResolutionPaymentItem)

// markPermanentEnteredFromZone -> extracted helper/utils

// finalizeBattlefieldAbilitySelfExertCost -> extracted helper/utils

// targetDescriptionFromType -> resolution-handlers/targetSelectionSacrificeFollowupHandlers.ts

// appendDungeonRoomExecuteEffectEvents / queueDungeonRoomPromptSteps /
// applyDungeonRoomEffectsWithDoubler -> resolution-handlers/optionChoiceVentureDungeonHandlers

function hasPendingSpellCastForPlayer(game: any, playerId: string): boolean {
  const pendingSpellCasts = Object.values(((game?.state as any)?.pendingSpellCasts || {})) as any[];
  return pendingSpellCasts.some((entry: any) => String(entry?.playerId || '') === String(playerId || ''));
}

// MANA_POOL_KEY_BY_SYMBOL / FLOATING_MANA_PAYMENT_PREFIX -> resolutionPaymentManaUtils

const PANGLACIAL_WURM_NAME = 'panglacial wurm';

// getFloatingPaymentPoolKey -> resolution-handlers/resolutionManaPaymentApplication




// Ward helpers live in resolutionWardUtils.ts (imported below with other socket extracts).


// extractResolutionPaymentItems -> resolution-handlers/resolutionManaPaymentApplication


// resumePlayerCastSpellFromHand -> extracted helper/utils

// validateWardManaPaymentSelection -> resolution-handlers/resolutionManaPaymentApplication

// applyWardManaPaymentSelection -> resolution-handlers/resolutionManaPaymentApplication

// applySelectedManaPaymentForResolutionCost -> resolution-handlers/resolutionManaPaymentApplication

const RESOLUTION_PAYMENT_MANA_KEYS = ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const;

// Counter-removal cost selection parsing/validation
// -> resolution-handlers/resolutionCounterRemovalPaymentSelection

// appendCastFromExilePromptResolveEvent -> resolution-handlers/optionChoiceCastFromExilePrompts
// appendCastFromGraveyardPromptResolveEvent -> resolution-handlers/optionChoiceCastFromGraveyardPrompts

// triggeredSourceExilesSpellCastThisWay -> extracted helper/utils

export async function handleAIResolutionStep(
  io: Server,
  gameId: string,
  step: ResolutionStep,
  options?: { force?: boolean },
): Promise<void> {
  try {
    const game = ensureGame(gameId);
    if (!game) return;

    const stillPending = ResolutionQueueManager.getQueue(gameId).steps.some(
      (queuedStep) =>
        queuedStep.id === step.id
        && queuedStep.status === ResolutionStepStatus.PENDING,
    );
    if (!stillPending) {
      // Another AI listener may have completeStep'd mutate without applying
      // pendingSpellCasts.mutateTarget / the payment queue.
      if (step.type === ResolutionStepType.MUTATE_TARGET_SELECTION) {
        const completed = ResolutionQueueManager.getQueue(gameId).completedSteps.find(
          (entry) => entry.id === step.id && entry.response,
        );
        if (completed?.response) {
          await applyResolutionStepSideEffects(io, game, gameId, step, completed.response);
        }
      }
      return;
    }
    
    if (!options?.force && !shouldAutoResolveResolutionStep(game, step.playerId)) return;

    debug(2, `[Resolution] Auto-resolving step for ${step.playerId}: ${step.type}`);
    
    let response: ResolutionStepResponse | null = null;
    
    switch (step.type) {
      case ResolutionStepType.X_VALUE_SELECTION:
      case ResolutionStepType.MANA_COLOR_SELECTION:
      case ResolutionStepType.HAND_TO_BOTTOM:
      case ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE:
      case ResolutionStepType.HIDEAWAY_CHOICE:
      case ResolutionStepType.REPEATED_ZONE_DRAFT:
      case ResolutionStepType.JOIN_FORCES: {
        response = buildAiHandAndDraftStepResponse(game, step);
        break;
      }

      case ResolutionStepType.FIGHT_TARGET:
      case ResolutionStepType.TAP_UNTAP_TARGET:
      case ResolutionStepType.TARGET_SELECTION:
      case ResolutionStepType.MUTATE_TARGET_SELECTION:
      case ResolutionStepType.COUNTER_MOVEMENT:
      case ResolutionStepType.COUNTER_TARGET: {
        response = buildAiTargetSelectionStepResponse(game, gameId, step, {
          getFilteredValidTargetsForStep,
        });
        break;
      }

      case ResolutionStepType.STATION_CREATURE_SELECTION:
      case ResolutionStepType.LIFE_PAYMENT:
      case ResolutionStepType.ADDITIONAL_COST_PAYMENT:
      case ResolutionStepType.SQUAD_COST_PAYMENT:
      case ResolutionStepType.EXPLORE_DECISION:
      case ResolutionStepType.BATCH_EXPLORE_DECISION:
      case ResolutionStepType.MODE_SELECTION:
      case ResolutionStepType.OPENING_HAND_ACTIONS:
      case ResolutionStepType.TEMPTING_OFFER:
      case ResolutionStepType.ACTIVATED_ABILITY: {
        response = buildAiCostAndExploreStepResponse(game, step);
        break;
      }
      
      case ResolutionStepType.LIBRARY_SEARCH:
      case ResolutionStepType.GRAVEYARD_SELECTION:
      case ResolutionStepType.SCRY:
      case ResolutionStepType.SURVEIL:
      case ResolutionStepType.BOTTOM_ORDER:
      case ResolutionStepType.LIM_DULS_VAULT:
      case ResolutionStepType.DANCE_WITH_CALAMITY:
      case ResolutionStepType.DANCE_WITH_CALAMITY_CAST:
      case ResolutionStepType.DISCARD_SELECTION: {
        response = buildAiZoneSelectionStepResponse(game, step);
        break;
      }
      
      case ResolutionStepType.COLOR_CHOICE:
      case ResolutionStepType.CREATURE_TYPE_CHOICE:
      case ResolutionStepType.CARD_NAME_CHOICE:
      case ResolutionStepType.OPTION_CHOICE:
      case ResolutionStepType.MODAL_CHOICE:
      case ResolutionStepType.PLAYER_CHOICE:
      case ResolutionStepType.CASCADE:
      case ResolutionStepType.PONDER_EFFECT:
      case ResolutionStepType.TWO_PILE_SPLIT:
      case ResolutionStepType.DEVOUR_SELECTION:
      case ResolutionStepType.PROLIFERATE:
      case ResolutionStepType.LIFE_REDISTRIBUTION:
      case ResolutionStepType.FATESEAL:
      case ResolutionStepType.CLASH:
      case ResolutionStepType.VOTE:
      case ResolutionStepType.KYNAIOS_CHOICE:
      case ResolutionStepType.UPKEEP_SACRIFICE:
      case ResolutionStepType.RIOT_CHOICE:
      case ResolutionStepType.UNLEASH_CHOICE: {
        response = buildAiSimpleChoiceStepResponse(game, step);
        break;
      }
      
      case ResolutionStepType.FABRICATE_CHOICE:
      case ResolutionStepType.TRIBUTE_CHOICE:
      case ResolutionStepType.EXPLOIT_CHOICE:
      case ResolutionStepType.BACKUP_CHOICE:
      case ResolutionStepType.MENTOR_TARGET:
      case ResolutionStepType.ENLIST_CHOICE:
      case ResolutionStepType.EXTORT_PAYMENT:
      case ResolutionStepType.MODULAR_CHOICE:
      case ResolutionStepType.SOULSHIFT_TARGET:
      case ResolutionStepType.HAUNT_TARGET: {
        response = buildAiKeywordChoiceStepResponse(step);
        break;
      }

      case ResolutionStepType.TRIGGER_ORDER: {
        const triggerStep = step as any;
        const triggers = Array.isArray(triggerStep.triggers) ? triggerStep.triggers : [];
        const orderedTriggerIds = triggers
          .map((trigger: any) => String(trigger?.id || ''))
          .filter((id: string) => id.length > 0);

        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: orderedTriggerIds,
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI trigger order: ${orderedTriggerIds.join(', ') || 'none'}`);
        break;
      }

      case ResolutionStepType.MANA_PAYMENT_CHOICE: {
        const stepData = step as any;

        if (
          stepData.spellPaymentRequired === true ||
          stepData.sacrificeUnlessPayChoice === true ||
          stepData.activationPaymentChoice === true
        ) {
          const selections = await chooseAISpellPaymentSelections(io, gameId, game, step.playerId as any, stepData);
          if (!selections) {
            debugWarn(1, `[Resolution] AI could not assemble payment for ${String(stepData.cardName || stepData.sourceName || 'spell')}; cancelling prompt`);
            response = {
              stepId: step.id,
              playerId: step.playerId,
              selections: { payment: [] },
              cancelled: true,
              timestamp: Date.now(),
            };
          } else {
            response = {
              stepId: step.id,
              playerId: step.playerId,
              selections,
              cancelled: false,
              timestamp: Date.now(),
            };
          }
          break;
        }

        break;
      }
      
      case ResolutionStepType.KEYWORD_CHOICE: {
        // Generic keyword choice - select first option
        const kwStep = step as any;
        const options = kwStep.options || [];

        if (options.length > 0) {
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [options[0].id || options[0]],
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI generic keyword choice: selected first option`);
        } else {
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: [],
            cancelled: false,
            timestamp: Date.now(),
          };
        }
        break;
      }

      // Default handler for any unhandled step types
      default: {
        // For any unhandled step type, attempt a generic response
        // This prevents the game from hanging indefinitely
        debugWarn(1, `[Resolution] AI has no specific handler for step type: ${step.type}, using generic decline`);
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: [],
          cancelled: false,
          timestamp: Date.now(),
        };
        break;
      }
    }
    
    if (response) {
      const success = ResolutionQueueManager.completeStep(gameId, step.id, response);
      if (success) {
        await applyResolutionStepSideEffects(io, game, gameId, step, response);
      }
    }
  } catch (error) {
    debugError(1, `[Resolution] Error handling AI resolution step:`, error);
  }
}





/**
 * Initialize global AI resolution handler
 * Should be called once when server starts
 */
export function initializeAIResolutionHandler(io: Server) {
  // Set up global handler for AI steps
  const aiHandler = (
    event: ResolutionQueueEvent,
    gameId: string,
    step?: ResolutionStep
  ) => {
    if (event === ResolutionQueueEvent.STEP_ADDED && step) {
      // Defer so addStep during handleStepResponse / Oracle IR resume cannot recurse synchronously.
      setImmediate(() => {
        handleAIResolutionStep(io, gameId, step).catch(err => {
          debugError(1, `[Resolution] AI handler error:`, err);
        });
      });
    }
  };
  
  ResolutionQueueManager.on(aiHandler);
  debug(1, '[Resolution] AI handler initialized');

  return aiHandler;
}

/**
 * Initialize global priority management handler
 * Manages priority state during resolution per MTG Rule 608.2
 * Should be called once when server starts
 */
export function initializePriorityResolutionHandler(io: Server): void {
  priorityResolutionHandlerState.io = io;
  if (priorityResolutionHandlerState.initialized) return;
  priorityResolutionHandlerState.initialized = true;

  // Import priority management functions
  import("../state/modules/priority.js").then(({ enterResolutionModeIfQueuePending, exitResolutionMode }) => {
    const priorityHandler = (
      event: ResolutionQueueEvent,
      gameId: string,
      step?: ResolutionStep
    ) => {
      const game = ensureGame(gameId);
      if (!game) return;
      
      const ctx = (game as any).ctx || game;
      if (!ctx) return;
      // Heal "unknown"/missing ctx.gameId so enter/exit consult the same queue
      // that queueResolveTopOfStackPrompt wrote (state.id / event gameId).
      bindCanonicalResolutionQueueGameId(ctx, gameId);
      
      // When any step is added, enter resolution mode (set priority = null).
      // APNAP batches queue every step before the first STEP_ADDED emit.
      if (event === ResolutionQueueEvent.STEP_ADDED) {
        if (enterResolutionModeIfQueuePending(ctx, gameId)) {
          broadcastGame(priorityResolutionHandlerState.io || io, game, gameId);
        }
      }
      
      // When last step completes or is cancelled, exit resolution mode.
      if (
        (event === ResolutionQueueEvent.STEP_COMPLETED || event === ResolutionQueueEvent.STEP_CANCELLED)
        && ctx.state.priority === null
        && !contextHasPendingResolutionSteps(ctx, gameId)
        && !contextHasBlockingNonPaymentResolutionSteps(ctx, gameId)
      ) {
        exitResolutionMode(ctx);
        broadcastGame(priorityResolutionHandlerState.io || io, game, gameId);
      }

      if (event === ResolutionQueueEvent.STEP_ADDED && step) {
        scheduleResolutionStepTimeoutForGame(gameId, step);
      }
      if (
        (event === ResolutionQueueEvent.STEP_COMPLETED || event === ResolutionQueueEvent.STEP_CANCELLED)
        && step
      ) {
        clearScheduledResolutionStepTimeout(gameId, String(step.id || ''));
      }
      if (event === ResolutionQueueEvent.QUEUE_CHANGED) {
        scheduleResolutionStepTimeoutForGame(gameId);
      }
    };
    
    ResolutionQueueManager.on(priorityHandler);
    debug(1, '[Resolution] Priority management handler initialized');
  });
}






// normalizeResolutionCardId / buildResolutionHandIdSet -> resolutionDiscardResponseCoreHandlers.ts

export async function applyResolutionStepSideEffects(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  await handleStepResponse(io, game, gameId, step, response);
  maybeResumeDeferredOracleIrStackSpellOnGame(game, gameId);
  broadcastGame(io, game, gameId);
}

/**
 * Handle discard selection response
 */
// handleDiscardResponse -> resolutionDiscardResponseCoreHandlers.ts (via resolutionHandlerDeps)



/**
 * Handle Join Forces mana contribution response
 * Each player may pay any amount of mana to contribute to the effect
 */

export async function resolveSequentialPileSplitForAI(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const pileCount = Math.max(2, Math.floor(Number(stepData.pileCount ?? 2)));
  const selections = response.selections as any;
  const piles = Array.isArray(selections?.piles)
    ? selections.piles.slice(0, pileCount).map((pile: any) =>
        (Array.isArray(pile) ? pile : []).map(String))
    : [
        Array.isArray(selections?.pileA) ? selections.pileA.map(String) : [],
        Array.isArray(selections?.pileB) ? selections.pileB.map(String) : [],
        ...(pileCount > 2
          ? [Array.isArray(selections?.pileC) ? selections.pileC.map(String) : []]
          : []),
      ];
  await handleSequentialOracleIrPileSplitResponse(io, game, gameId, stepData, response, piles);
}

/** Apply library-chaos target side effects after an AI completes its queue step. */
export async function resolveLibraryChaosTargetSelectionForAI(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  await handleTargetSelectionResponse(io, game, gameId, step, response);
}

/** Apply a library-chaos free-cast choice after an AI completes its queue step. */
export async function resolveLibraryChaosCastChoiceForAI(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  await handleOptionChoiceResponse(io, game, gameId, step, response);
}




// getNextEndStepFireTurnNumberForResolution -> extracted helper/utils

// getNextUpkeepNotBeforeTurnNumberForResolution -> extracted helper/utils

// handleGraveyardSelectionResponse -> extracted helper/utils

export default { registerResolutionHandlers };
