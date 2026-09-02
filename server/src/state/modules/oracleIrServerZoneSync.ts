import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep, OracleQuantity } from '../../../../rules-engine/src/oracleIR.js';
import {
  applyOracleIRStepsToGameState,
  buildOracleIRExecutionContext,
  type OracleIRExecutionContext,
  type OracleIRExecutionOptions,
  type OracleIRExecutionResult,
} from '../../../../rules-engine/src/oracleIRExecutor.js';
import { resolveSingleCreatureTargetId } from '../../../../rules-engine/src/oracleIRExecutorCreatureStepUtils.js';
import { resolveBoundSelfOrSourceCreatureTargetId } from '../../../../rules-engine/src/oracleIRExecutorBoundSelfCreatureTarget.js';
import { resolveOracleQuantity, resolveOracleQuantityForPlayer } from '../../../../rules-engine/src/oracleIRExecutorResolveQuantity.js';
import { tryEvaluateCombatDamageReferenceCount } from '../../../../rules-engine/src/oracleIRExecutorCombatDamageCounts.js';
import { normalizeOracleManaCostString } from '../../../../rules-engine/src/oracleIRExecutorManaUtils.js';
import {
  getPlayableUntilTurnForImpulseDuration,
  impulseExileTopIsDiscoverCastOrHand,
  impulseExileTopRequiresChooseOne,
  resolvePlayers,
} from '../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';
import { buildSacrificeTargetSelectionOptions } from '../../../../rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.js';
import {
  collectDiscardSelectionOptionsForStep,
  buildExploreDecisionFromStep,
  buildMoveZoneSelectionOptions,
  buildPlayerChoiceAmongThemSelectionOptions,
} from '../../../../rules-engine/src/oracleIRExecutorPlayerStepHandlers.js';
import { getProliferateChoiceTargets, buildPopulateTargetSelectionOptions } from '../../../../rules-engine/src/oracleIRExecutorKeywordStepHandlers.js';
import { getExploreActionCount, getProliferateActionCount } from './keywordActionRepetition.js';
import { queueFlipCoinLifeStakesLoop } from './flipCoinLifeStakes.js';
import { ResolutionQueueManager, ResolutionStepStatus, ResolutionStepType } from '../resolution/index.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';
import {
  attachOracleIrResumeMetadata,
  findSkippedOracleStep,
  isOracleIrPlayerChoiceGap,
  normalizeTopLibraryPromptCard,
  unwrapYouDoResumeSteps,
} from './oracleIrServerPromptResumeUtils.js';
import { queueTopLibraryChoicePromptsFromOracleIRResult } from './oracleIrServerScrySurveilPromptUtils.js';
import { queueBlightChoicePromptsFromOracleIRResult } from './oracleIrServerBlightPromptUtils.js';
import { isOracleIrTriggerPrimaryEnabled } from './oracleIrTriggerExecution.js';
import { processSpellCounteredTriggers } from './spellCounteredTriggerUtils.js';
import {
  emitTriggersAfterOracleIRApply,
  snapshotBattlefieldForTriggerEmission,
} from './oracleIrPostApplyTriggerEmission.js';
import { queuePayLifeTriggers } from './triggers/pay-life.js';
import { evaluateCounterPlacementReplacementEvent, evaluateMillReplacementEvent } from './replacement-effects.js';
import { processDrawTriggers, processMillTriggers } from './zones.js';
import { recordCardPutIntoGraveyardThisTurn } from './turn-tracking.js';
import {
  applyCopyPermanentTriggerStep,
  copyPermanentTriggerStepNeedsTargetSelectionQueue,
} from './trigger-copy-permanent.js';
import { queueCopySpellStackPushFromOracleIRResult, queueCastableCopiedSpellPromptsFromOracleIRResult } from './oracleIrServerCopySpellSync.js';
import { appendCopyTriggeredAbilityResolveEvent } from './triggerAbilityCopyUtils.js';
import { payManaCostWithAvailableSources } from '../../socket/util.js';
import {
  syncPreparedPermanentAfterControlChange,
  resyncPreparedExileCopiesWithControllers,
} from './prepared.js';
import { scheduleExiledCardReturnToBattlefield } from './executeSpellEffect.js';
import { scheduleDelayedDrawAtNextUpkeep } from './triggerDelayedEffectUtils.js';
import { parseSimplePermanentTypeFromText } from '../../../../rules-engine/src/oracleIRExecutorBattlefieldParser.js';
import { isOracleIrOptionalStepBridgedToDedicatedResolutionPrompt } from '../../../../rules-engine/src/oracleIRPerPlayerOptional.js';
import { hasExecutorClass } from '../../../../rules-engine/src/oracleIRExecutorPermanentUtils.js';
import {
  isEachPlayerMayPutLandFromHandStep,
  isControllerMayPutLandFromHandStep,
  isBothPlayersMayPutPermanentFromHandStep,
  queueEachPlayerMayPutLandOrDrawBatch,
  queueControllerLandPlayOrDrawPrompt,
  queueLandPlayFromHandPrompt,
  queueBothPlayersMayPutPermanentFromHandPrompts,
} from './triggerLandPlayPromptUtils.js';
import { queueEachPlayerCounterPlacementPromptsFromOracleIRResult } from './triggerCounterPlacementPromptUtils.js';
import { bridgeGameStateOracleEffectsAfterOracleIR } from './triggerGameStateOracleBridgeUtils.js';
import { bridgeCreatedTokenEtbTriggersAfterOracleIR } from './triggerOracleIrTokenEtbBridge.js';
import { queueOracleIrReflexiveWhenYouDoFollowups } from './triggerReflexiveWhenYouDoQueueUtils.js';
import {
  executeLibraryChaosExchange,
  permanentMatchesLibraryChaosTarget,
  queueLibraryChaosCastOffers,
  type LibraryChaosExchangeStep,
} from './oracleIrLibraryChaosExchange.js';
import {
  applyCounterModifications,
  updateCounters,
} from './counters_tokens.js';
import { syncDerivedContinuousEffects } from './staticEffectSpec.js';
import { mirrorGraveyardCastingPermissionsToDurable } from './graveyard-permissions.js';
import { syncCastingModifierGrantsFromOracleIRResult } from './casting-modifiers.js';
import { enrichTokenCardImages } from '../../services/tokens.js';
import { debugWarn } from '../../utils/debug.js';
import {
  createOracleIRServerExecutionBridge,
  queueOracleIrDeferredReplacementPrompts,
  clearOracleIrPendingCompoundResumeOnState,
  persistOracleIrCompoundDrawAfterResolution,
  readAppliedStepKindsFromState,
  readStepLedgerFromState,
  resolveOracleIrChoiceStepIndex,
  resolveOracleIrContinuationStepIndex,
} from './oracleIrTransitionPipeline.js';
import { persistOracleIrReplayMutationsFromExecution, persistCounterDiffsFromOracleIR } from '../effects/effectProgramReplayMutationPersistence.js';
import {
  persistBattlefieldPermanentPatchesFromOracleIR,
  snapshotBattlefieldPermanentReplayPatches,
} from '../effects/battlefieldPermanentReplayPersistence.js';
import { createEmptyStepLedger } from '../../../../rules-engine/src/oracleIRStepLedger.js';
import type { OracleIRTransitionHaltState } from '../../../../rules-engine/src/oracleIRExecutionTypes.js';
import { resolveOracleIrBoundTargetSpellId } from '../../../../rules-engine/src/oracleIrTargetBinding.js';
import type { GameContext } from '../context.js';
import {
  syncIrAtNextEndStepTokenSacrificeFromOracleIRResult,
  syncIrCopyTokenProvenanceFromOracleIRResult,
  syncIrGraveyardExilesToSourcePermanentExiledCards,
  syncIrImpulseExileToPendingImpulseDraws,
  syncIrLinkedExilesFromOracleIRResult,
  syncIrPowerToughnessModifiersToTemporaryPTMods,
  syncIrPreparedStateFromOracleIRResult,
  syncIrReanimationRidersFromOracleIRResult,
  syncIrTemporaryGrantEffectsToServerTemporaryAbilities,
} from './oracleIrServerZoneSync-handlers/index.js';
import {
  queueLookChooseChoicePromptsFromOracleIRResult,
  queueSearchLibraryChoicePromptsFromOracleIRResult,
  queueChoosePileChoicePromptsFromOracleIRResult,
} from './oracleIrServerZoneSync-handlers/oracleIrServerLibrarySearchLookChoosePilePrompts.js';
import {
  queueJoinForcesPromptsFromOracleIRResult,
  queueVotePromptsFromOracleIRResult,
} from './oracleIrServerZoneSync-handlers/oracleIrServerVoteJoinForcesPrompts.js';
import {
  queueTapMatchingPermanentsChoicePromptsFromOracleIRResult,
  queueTapOrUntapChoicePromptsFromOracleIRResult,
} from './oracleIrServerZoneSync-handlers/oracleIrServerTapUntapChoicePrompts.js';
import {
  queueExploreChoicePromptsFromOracleIRResult,
  queuePopulateChoicePromptsFromOracleIRResult,
  queueChangeTargetChoicePromptsFromOracleIRResult,
} from './oracleIrServerZoneSync-handlers/oracleIrServerExplorePopulateChangeTargetPrompts.js';
import {
  queueRepeatedZoneDraftChoicePromptFromOracleIRResult,
  queueSeparateIntoPilesPromptsFromOracleIRResult,
  bridgeLibraryChaosExchangeFromOracleIRResult,
} from './oracleIrServerZoneSync-handlers/oracleIrServerZoneDraftPilesChaosPrompts.js';
import { hasPendingWarpWorldOracleIrPrompt } from './oracleIrServerZoneSync-handlers/oracleIrServerWarpWorldChoicePrompts.js';
import { maybeFlushChaosResolutionZoneTriggersIfIdle } from './oracleIrChaosResolutionTriggerHold.js';
import {
  queueCopyPermanentChoicePromptsFromOracleIRResult,
  queueMoveZoneChoicePromptsFromOracleIRResult,
  queueMoveZoneDestinationChoicePromptsFromOracleIRResult,
} from './oracleIrServerZoneSync-handlers/oracleIrServerCopyPermanentMoveZonePrompts.js';
import {
  collectGrantGraveyardPermissionModifyMetadata,
  resolveGrantGraveyardCastChoiceCard,
  syncGraveyardCastFreeExilePermissionsFromOracleIR,
  syncImpulseExilePlayPermissionsToState,
  queueChooseOneImpulseExilePlayPromptsFromOracleIRResult,
  queueDiscoverCastOrHandPromptsFromOracleIRResult,
} from './oracleIrServerZoneSync-handlers/oracleIrServerImpulseDiscoverGyPermissionPrompts.js';
import {
  applyOracleIrOptionalLifePayment,
  resolveOptionalPayLifeAmount,
  queueOptionalStepChoicePromptsFromOracleIRResult,
} from './oracleIrServerZoneSync-handlers/oracleIrServerOptionalStepChoicePrompts.js';
import {
  persistUnqueuedPendingContinuationFromOracleIRResult,
  syncNextSpellCostReductionFromOracleIRResult,
} from './oracleIrServerZoneSync-handlers/oracleIrServerPendingContinuationAndCostReduction.js';
import { queueUnlessPayChoicePromptsFromOracleIRResult } from './oracleIrServerZoneSync-handlers/oracleIrServerUnlessPayChoicePrompts.js';
import {
  poolKeyToManaSymbol,
  buildChosenManaFromDistribution,
  queueAddManaChoicePromptsFromOracleIRResult,
  queueAddCounterTargetSelectionPromptsFromOracleIRResult,
  queueCounterDistributionPromptsFromOracleIRResult,
} from './oracleIrServerZoneSync-handlers/oracleIrServerManaCounterChoicePrompts.js';
import {
  queueConniveChoicePromptsFromOracleIRResult,
  queuePlayerChoicePromptsFromOracleIRResult,
  syncIrPendingDiscardFromOracleIRResult,
} from './oracleIrServerZoneSync-handlers/oracleIrServerConnivePlayerChoicePrompts.js';
import {
  queueControllerMayPutLandFromHandPromptsFromOracleIRResult,
  queueEachPlayerMayPutLandFromHandPromptsFromOracleIRResult,
  queueBothPlayersMayPutPermanentFromHandPromptsFromOracleIRResult,
} from './oracleIrServerZoneSync-handlers/oracleIrServerLandFromHandPrompts.js';
import {
  queueDiscardChoicePromptsFromOracleIRResult,
  queueProliferateChoicePromptsFromOracleIRResult,
} from './oracleIrServerZoneSync-handlers/oracleIrServerDiscardProliferatePrompts.js';
import {
  queueRedistributeLifeTotalsPromptsFromOracleIRResult,
  queueFlipCoinLifeStakesPromptsFromOracleIRResult,
} from './oracleIrServerZoneSync-handlers/oracleIrServerLifeFlipCoinPrompts.js';
import {
  enrichBattlefieldTokenImages,
  buildShadowProbeContext,
  hydrateOracleIRPlayerZonesFromContext,
  snapshotGraveyardCardIds,
  snapshotExileCardIds,
  bridgeScheduleDelayedDrawAtNextUpkeepFromOracleIRResult,
  bridgeScheduleDelayedFlickerReturnsFromOracleIRResult,
  syncOracleIRPlayerZonesToContext,
  syncAllOracleIRPlayerZonesAfterResolution,
} from './oracleIrServerZoneSync-handlers/oracleIrServerZoneHydrateDelayedBridges.js';
import {
  snapshotBattlefieldControllers,
  snapshotBattlefieldCounters,
  syncCounterReplacementEffectsAfterOracleIR,
  syncPreparedCopiesAfterBattlefieldControllerChanges,
  syncPreparedCopiesFromControlChangeEffects,
  applyMillReplacementEffectsToSteps,
} from './oracleIrServerZoneSync-handlers/oracleIrServerMillCounterPreparedSync.js';
import { applyOracleIRStepsOnServer } from './oracleIrServerZoneSync-handlers/oracleIrServerApplyOnServer.js';
import { bindQueueSacrificeChoicePromptsFromOracleIRResult } from './oracleIrServerZoneSync-handlers/oracleIrServerApplyDeps.js';
import {
  extractOracleIrSelectionIds,
  maybeApplyOracleIrChoiceStepFromResolution,
  resumeOracleIRRemainingStepsFromResolution,
  resumeOracleIRStepWithChoiceFromResolution,
  resumeOracleIRUnlessDiscardsFromResolution,
  resumeOracleIRUnlessPayFromResolution,
} from './oracleIrServerZoneSync-handlers/oracleIrServerResumeAndChoiceApply.js';
import {
  parseAnyPlayerMayPaymentJson,
  resumeAnyPlayerMayAfterChoice,
  maybeQueueAnyPlayerMayPaymentSelection,
  resolveOracleIrAnyPlayerMayPaymentSelectionFromResolution,
} from './oracleIrServerZoneSync-handlers/oracleIrServerAnyPlayerMayPrompts.js';
import { queueCastFromExileResolutionPrompt } from './triggerCastFromExileUtils.js';
import { grantNextSpellCostReduction } from './nextSpellCostReduction.js';
import { describeAnyPlayerMayPayment, type AnyPlayerMayPayment } from '../../../../rules-engine/src/oracleIRAnyPlayerMay.js';

type MutableOracleIRExecutionResult = {
  -readonly [K in keyof OracleIRExecutionResult]: OracleIRExecutionResult[K];
};

export {
  buildShadowProbeContext,
  hydrateOracleIRPlayerZonesFromContext,
  snapshotGraveyardCardIds,
  syncOracleIRPlayerZonesToContext,
  syncAllOracleIRPlayerZonesAfterResolution,
};
export { applyMillReplacementEffectsToSteps };
export { applyOracleIRStepsOnServer };
export {
  extractOracleIrSelectionIds,
  maybeApplyOracleIrChoiceStepFromResolution,
  resumeOracleIRRemainingStepsFromResolution,
  resumeOracleIRStepWithChoiceFromResolution,
  resumeOracleIRUnlessDiscardsFromResolution,
  resumeOracleIRUnlessPayFromResolution,
};
export {
  parseAnyPlayerMayPaymentJson,
  resumeAnyPlayerMayAfterChoice,
  maybeQueueAnyPlayerMayPaymentSelection,
  resolveOracleIrAnyPlayerMayPaymentSelectionFromResolution,
};

export function resolveOracleIrOptionalPaymentPromptFromResolution(
  ctx: GameContext,
  params: {
    step: any;
    choiceId: string;
    cancelled: boolean;
  },
): boolean {
  const step = params.step;
  const stepData = (step && typeof step === 'object') ? step as Record<string, unknown> : {};
  if (stepData.optionalPaymentPrompt !== true) return false;
  if (
    stepData.oracleIrUnlessPayChoice !== true
    && stepData.oracleIrOptionalPayManaChoice !== true
    && stepData.oracleIrOptionalMayChoice !== true
    && stepData.oracleIrUnlessDiscardsChoice !== true
    && stepData.oracleIrAnyPlayerMayChoice !== true
  ) {
    return false;
  }

  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') return false;

  const state = (ctx as any).state;

  const playerId = String(stepData.playerId || step?.playerId || '').trim() as PlayerID;
  const choiceId = String(params.choiceId || '').trim();
  const payChoiceId = String(stepData.optionalPaymentPayChoiceId || 'pay').trim();
  const choiceManaAmount = choiceId.startsWith('pay:') ? choiceId.slice(4) : '';
  const paid = !params.cancelled && (choiceId === payChoiceId || choiceId === 'pay' || Boolean(choiceManaAmount));

  if (paid && String(stepData.optionalPaymentValidationKind || '') === 'mana') {
    const manaCost = String(choiceManaAmount || stepData.optionalPaymentManaCost || stepData.manaCost || '').trim();
    if (manaCost) {
      payManaCostWithAvailableSources((ctx as any).state, playerId, manaCost);
    }
  }

  if (
    paid
    && (
      String(stepData.optionalPaymentValidationKind || '') === 'life'
      || stepData.oracleIrUnlessPayKind === 'life'
    )
  ) {
    const lifeAmount = Number(stepData.optionalPaymentLifeAmount || 0);
    if (Number.isFinite(lifeAmount) && lifeAmount > 0 && !(ctx as any).isReplaying) {
      applyOracleIrOptionalLifePayment(state, playerId, lifeAmount);
      try {
        queuePayLifeTriggers(ctx, playerId, lifeAmount, {
          sourceId: String(stepData.oracleIrSourceId || stepData.sourceId || '').trim() || undefined,
          sourceName: String(stepData.oracleIrSourceName || stepData.sourceName || 'Oracle IR life payment').trim()
            || 'Oracle IR life payment',
        });
      } catch {
        // best-effort
      }
    }
  }

  if (stepData.oracleIrAnyPlayerMayChoice === true) {
    let anySteps: OracleEffectStep[] = [];
    try {
      const parsed = JSON.parse(String(stepData.oracleIrAnyPlayerMayStepsJson || '[]'));
      anySteps = Array.isArray(parsed) ? parsed as OracleEffectStep[] : [];
    } catch {
      anySteps = [];
    }
    const declined = Array.isArray(stepData.oracleIrAnyPlayerMayDeclinedIds)
      ? [...(stepData.oracleIrAnyPlayerMayDeclinedIds as string[])].map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const candidates = Array.isArray(stepData.oracleIrAnyPlayerMayCandidateIds)
      ? [...(stepData.oracleIrAnyPlayerMayCandidateIds as string[])].map((id) => String(id || '').trim()).filter(Boolean)
      : [];

    const controller = String(stepData.oracleIrControllerId || playerId).trim() as PlayerID;
    const sourceId = String(stepData.oracleIrSourceId || stepData.sourceId || '').trim() || undefined;
    const sourceName = String(stepData.oracleIrSourceName || stepData.sourceName || '').trim() || undefined;
    const targetSpellId = String(stepData.oracleIrTargetSpellId || '').trim() || undefined;

    if (paid) {
      const base = {
        controller,
        sourceId,
        sourceName,
        targetSpellId,
        anySteps,
        declined,
        candidates,
        payment: parseAnyPlayerMayPaymentJson(stepData.oracleIrAnyPlayerMayPaymentJson),
      };
      if (maybeQueueAnyPlayerMayPaymentSelection(ctx, state, stepData, playerId, base)) {
        return true;
      }
      resumeAnyPlayerMayAfterChoice(ctx, {
        controller,
        sourceId,
        sourceName,
        targetSpellId,
        steps: anySteps,
        playerId,
        paid: true,
        declined,
      });
      return true;
    }

    resumeAnyPlayerMayAfterChoice(ctx, {
      controller,
      sourceId,
      sourceName,
      targetSpellId,
      steps: anySteps,
      playerId,
      paid: false,
      declined,
    });
    return true;
  }

  if (paid) {
    if (stepData.oracleIrUnlessPayChoice === true) {
      let unlessSteps: OracleEffectStep[] = [];
      try {
        const parsed = JSON.parse(String(stepData.oracleIrUnlessPayStepsJson || '[]'));
        unlessSteps = Array.isArray(parsed) ? parsed as OracleEffectStep[] : [];
      } catch {
        unlessSteps = [];
      }
      if (unlessSteps.length > 0) {
        resumeOracleIRUnlessPayFromResolution(ctx, {
          controller: String(stepData.oracleIrControllerId || playerId).trim() as PlayerID,
          sourceId: String(stepData.oracleIrSourceId || stepData.sourceId || '').trim() || undefined,
          sourceName: String(stepData.oracleIrSourceName || stepData.sourceName || '').trim() || undefined,
          steps: unlessSteps,
          unlessPayKind: stepData.oracleIrUnlessPayKind === 'life' ? 'life' : 'mana',
          choice: 'pay',
          targetSpellId: String(stepData.oracleIrTargetSpellId || '').trim() || undefined,
          targetPermanentId: String(stepData.oracleIrTargetPermanentId || '').trim() || undefined,
          unlessPaysManaAmount: String(choiceManaAmount || stepData.optionalPaymentManaCost || '').trim() || undefined,
        });
      }
    } else if (stepData.oracleIrOptionalMayChoice === true) {
      let choiceSteps: OracleEffectStep[] = [];
      try {
        const parsed = JSON.parse(String(stepData.oracleIrChoiceStepJson || '[]'));
        choiceSteps = Array.isArray(parsed) ? parsed as OracleEffectStep[] : [];
      } catch {
        choiceSteps = [];
      }
      if (choiceSteps.length > 0) {
        const lifeAlreadyPaid =
          String(stepData.optionalPaymentValidationKind || '') === 'life'
          && Number(stepData.optionalPaymentLifeAmount || 0) > 0;
        const resumeSteps = choiceSteps
          .filter((choiceStep) => !(lifeAlreadyPaid && choiceStep.kind === 'lose_life'))
          .map((choiceStep) => (
            choiceStep.kind === 'lose_life' && (choiceStep as { optional?: boolean }).optional === true
              ? { ...choiceStep, optional: false }
              : choiceStep
          ));
        if (resumeSteps.length > 0) {
          resumeOracleIRStepWithChoiceFromResolution(ctx, {
            controller: String(stepData.oracleIrControllerId || playerId).trim() as PlayerID,
            sourceId: String(stepData.oracleIrSourceId || stepData.sourceId || '').trim() || undefined,
            sourceName: String(stepData.oracleIrSourceName || stepData.sourceName || '').trim() || undefined,
            steps: resumeSteps,
            allowOptional: true,
            ...(Number.isFinite(Number(stepData.oracleIrXValue))
              ? { xValue: Number(stepData.oracleIrXValue) }
              : {}),
          });
        }
      }
      maybeResumeOracleIRStepsAfterResolution(ctx, step);
    } else if (stepData.oracleIrUnlessDiscardsChoice === true) {
      let unlessDiscardsSteps: OracleEffectStep[] = [];
      try {
        const parsed = JSON.parse(String(stepData.oracleIrUnlessDiscardsStepsJson || '[]'));
        unlessDiscardsSteps = Array.isArray(parsed) ? parsed as OracleEffectStep[] : [];
      } catch {
        unlessDiscardsSteps = [];
      }
      if (unlessDiscardsSteps.length > 0) {
        resumeOracleIRUnlessDiscardsFromResolution(ctx, {
          controller: String(stepData.oracleIrControllerId || playerId).trim() as PlayerID,
          sourceId: String(stepData.oracleIrSourceId || stepData.sourceId || '').trim() || undefined,
          sourceName: String(stepData.oracleIrSourceName || stepData.sourceName || '').trim() || undefined,
          steps: unlessDiscardsSteps,
          choice: 'discard',
        });
      }
    } else {
      maybeResumeOracleIRStepsAfterResolution(ctx, step);
    }
  } else if (stepData.oracleIrUnlessDiscardsChoice === true) {
    let unlessDiscardsSteps: OracleEffectStep[] = [];
    try {
      const parsed = JSON.parse(String(stepData.oracleIrUnlessDiscardsStepsJson || '[]'));
      unlessDiscardsSteps = Array.isArray(parsed) ? parsed as OracleEffectStep[] : [];
    } catch {
      unlessDiscardsSteps = [];
    }
    if (unlessDiscardsSteps.length > 0) {
      resumeOracleIRUnlessDiscardsFromResolution(ctx, {
        controller: String(stepData.oracleIrControllerId || playerId).trim() as PlayerID,
        sourceId: String(stepData.oracleIrSourceId || stepData.sourceId || '').trim() || undefined,
        sourceName: String(stepData.oracleIrSourceName || stepData.sourceName || '').trim() || undefined,
        steps: unlessDiscardsSteps,
        choice: 'decline',
      });
    }
  } else if (stepData.oracleIrUnlessPayChoice === true) {
    let unlessSteps: OracleEffectStep[] = [];
    try {
      const parsed = JSON.parse(String(stepData.oracleIrUnlessPayStepsJson || '[]'));
      unlessSteps = Array.isArray(parsed) ? parsed as OracleEffectStep[] : [];
    } catch {
      unlessSteps = [];
    }
    if (unlessSteps.length > 0) {
      resumeOracleIRUnlessPayFromResolution(ctx, {
        controller: String(stepData.oracleIrControllerId || playerId).trim() as PlayerID,
        sourceId: String(stepData.oracleIrSourceId || stepData.sourceId || '').trim() || undefined,
        sourceName: String(stepData.oracleIrSourceName || stepData.sourceName || '').trim() || undefined,
        steps: unlessSteps,
        unlessPayKind: stepData.oracleIrUnlessPayKind === 'life' ? 'life' : 'mana',
        choice: 'decline',
        targetSpellId: String(stepData.oracleIrTargetSpellId || '').trim() || undefined,
        targetPermanentId: String(stepData.oracleIrTargetPermanentId || '').trim() || undefined,
      });
    }
  } else if (stepData.oracleIrOptionalMayChoice === true) {
    // "You may pay. If you do, ?" ? declining the payment must not run the follow-up.
    if (stepData.optionalPaymentPrompt !== true) {
      maybeResumeOracleIRStepsAfterResolution(ctx, step);
    }
  } else if (stepData.copyTriggeredAbilityDeclineEvent === true) {
    appendCopyTriggeredAbilityResolveEvent(ctx, {
      sourceId: String(stepData.copyTriggeredAbilitySourceId || stepData.sourceId || '').trim() || undefined,
      sourceName: String(stepData.sourceName || 'Ability').trim() || 'Ability',
      controllerId: String(stepData.oracleIrControllerId || playerId).trim() || undefined,
      paid: false,
      manaCost: String(stepData.optionalPaymentManaCost || '').trim() || undefined,
      triggerStackItemId: String(stepData.copyTriggeredAbilityTriggerStackItemId || '').trim() || undefined,
      triggeringStackItemId: String(stepData.copyTriggeredAbilityTriggeringStackItemId || '').trim() || undefined,
    });
  }

  if (state) {
    syncAllOracleIRPlayerZonesAfterResolution(ctx);
  }

  if (typeof (ctx as any).bumpSeq === 'function') {
    (ctx as any).bumpSeq();
  }

  return true;
}

function buildOracleIrResumeContextFromResolutionStep(step: any): {
  chosenObjectIds?: string[];
  selectorContext?: Record<string, unknown>;
  voteChoiceCounts?: Record<string, number>;
  winningVoteChoice?: string | null;
} {
  const voteCountsRaw = step?.oracleIrVoteChoiceCounts;
  if (voteCountsRaw && typeof voteCountsRaw === 'object') {
    const voteChoiceCounts = Object.fromEntries(
      Object.entries(voteCountsRaw)
        .map(([choice, count]) => [String(choice || '').trim().toLowerCase(), Number(count) || 0])
        .filter(([choice]) => Boolean(choice)),
    );
    const winningRaw = step?.oracleIrWinningVoteChoice;
    const winningVoteChoice =
      winningRaw === null
        ? null
        : typeof winningRaw === 'string'
          ? winningRaw
          : undefined;
    return {
      voteChoiceCounts,
      ...(typeof winningVoteChoice !== 'undefined' ? { winningVoteChoice } : {}),
    };
  }

  const selectionIds = extractOracleIrSelectionIds(step?.response?.selections);
  if (selectionIds.length === 0) {
    return {};
  }

  const playerChoiceKind = String(step?.oracleIrPlayerChoiceKind || '').trim();
  if (playerChoiceKind === 'odd_even') {
    const normalized = selectionIds[0]!.toLowerCase();
    if (normalized === 'odd' || normalized === 'even') {
      return { selectorContext: { chosenOddEven: normalized } };
    }
  }
  if (playerChoiceKind === 'letter') {
    return { selectorContext: { chosenLetter: selectionIds[0]!.slice(0, 1) } };
  }

  return { chosenObjectIds: selectionIds };
}

export function maybeResumeOracleIRStepsAfterResolution(
  ctx: GameContext,
  step: any,
): OracleIRExecutionResult | null {
  try {
    const gameId = String((ctx as any).gameId || '').trim();
    if (gameId && gameId !== 'unknown' && hasPendingWarpWorldOracleIrPrompt(gameId, step?.id)) {
      return null;
    }
    if (String(step?.oracleIrWarpWorldChoice || '').trim()) {
      try {
        const parsed = JSON.parse(String(step?.oracleIrChoiceStepJson || '[]'));
        if (Array.isArray(parsed) && parsed.length > 1) return null;
      } catch {
        // fall through to resumeJson
      }
    }

    const resumeJson = String(step?.oracleIrResumeStepsJson || '').trim();
    if (!resumeJson) {
      return null;
    }

    let remainingSteps: OracleEffectStep[] = [];
    try {
      const parsed = JSON.parse(resumeJson);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return null;
      }
      remainingSteps = parsed as OracleEffectStep[];
    } catch {
      return null;
    }

    const resumeContext = buildOracleIrResumeContextFromResolutionStep(step);

    return resumeOracleIRRemainingStepsFromResolution(ctx, {
      controller: String(step?.oracleIrControllerId || step?.playerId || '').trim() as PlayerID,
      sourceId: String(step?.oracleIrSourceId || step?.sourceId || '').trim() || undefined,
      sourceName: String(step?.oracleIrSourceName || step?.sourceName || '').trim() || undefined,
      steps: remainingSteps,
      targetSpellId: String(step?.copyTriggeredAbilityTriggeringStackItemId || '').trim() || undefined,
      ...(resumeContext.chosenObjectIds ? { chosenObjectIds: resumeContext.chosenObjectIds } : {}),
      ...(resumeContext.selectorContext ? { selectorContext: resumeContext.selectorContext } : {}),
      ...(resumeContext.voteChoiceCounts ? { voteChoiceCounts: resumeContext.voteChoiceCounts } : {}),
      ...(typeof resumeContext.winningVoteChoice !== 'undefined'
        ? { winningVoteChoice: resumeContext.winningVoteChoice }
        : {}),
      ...(Number.isFinite(Number(step?.oracleIrXValue))
        ? { xValue: Number(step.oracleIrXValue) }
        : {}),
      triggerItem: String(step?.copyTriggeredAbilityTriggeringStackItemId || '').trim()
        ? {
            id: String(step?.copyTriggeredAbilityTriggerStackItemId || '').trim() || undefined,
            permanentId: String(step?.oracleIrSourceId || step?.sourceId || '').trim() || undefined,
            source: String(step?.oracleIrSourceId || step?.sourceId || '').trim() || undefined,
            triggeringStackItemId: String(step?.copyTriggeredAbilityTriggeringStackItemId || '').trim(),
            effectData: {
              triggeringStackItemId: String(step?.copyTriggeredAbilityTriggeringStackItemId || '').trim(),
            },
          }
        : undefined,
    });
  } finally {
    processPendingOracleIrCompoundResumeOnContext(ctx);
    maybeFlushChaosResolutionZoneTriggersIfIdle(ctx);
  }
}

export function resumeOracleIrPendingCompoundStepsFromState(
  ctx: GameContext,
): OracleIRExecutionResult | null {
  const state = (ctx as any).state;
  const resumeJson = String(state?.oracleIrPendingResumeStepsJson || '').trim();
  if (!resumeJson) return null;

  let remainingSteps: OracleEffectStep[] = [];
  try {
    const parsed = JSON.parse(resumeJson);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      clearOracleIrPendingCompoundResumeOnState(state);
      return null;
    }
    remainingSteps = parsed as OracleEffectStep[];
  } catch {
    return null;
  }

  const controller = String(
    state?.oracleIrPendingResumeControllerId || '',
  ).trim() as PlayerID;
  if (!controller) return null;

  const sourceId = String(state?.oracleIrPendingResumeSourceId || '').trim() || undefined;
  const sourceName = String(state?.oracleIrPendingResumeSourceName || '').trim() || undefined;

  // Consume before apply so nested persist can write a fresh halt leftover.
  const resumeSnapshot = {
    oracleIrPendingResumeStepsJson: state.oracleIrPendingResumeStepsJson,
    oracleIrPendingResumeControllerId: state.oracleIrPendingResumeControllerId,
    oracleIrPendingResumeSourceId: state.oracleIrPendingResumeSourceId,
    oracleIrPendingResumeSourceName: state.oracleIrPendingResumeSourceName,
  };
  clearOracleIrPendingCompoundResumeOnState(state);
  try {
    return resumeOracleIRRemainingStepsFromResolution(ctx, {
      controller,
      sourceId,
      sourceName,
      steps: remainingSteps,
    });
  } catch (err) {
    if (!String(state.oracleIrPendingResumeStepsJson || '').trim()) {
      Object.assign(state, resumeSnapshot);
    }
    throw err;
  }
}

export function processPendingOracleIrCompoundResumeOnContext(
  ctx: GameContext,
): OracleIRExecutionResult | null {
  if ((ctx as any).isReplaying) return null;
  const state = (ctx as any).state;
  if (!state || typeof state !== 'object') return null;
  if (!String(state.oracleIrPendingResumeStepsJson || '').trim()) return null;
  return resumeOracleIrPendingCompoundStepsFromState(ctx);
}

