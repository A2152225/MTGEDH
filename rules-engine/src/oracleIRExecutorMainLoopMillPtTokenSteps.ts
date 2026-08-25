// Origin parent: oracleIRExecutorMainLoop.ts
// Cluster moved: applyOracleIRStepsToGameStateImpl switch cases mill through
// grant_leave_battlefield_replacement (mill/P/T, life/damage, tap, counters, move_zone, tokens).
// Public entry symbol: tryApplyMainLoopMillPtTokenSteps.

import type { OracleEffectStep } from './oracleIR';
import { evaluateConditionalWrapperCondition } from './oracleIRExecutorConditionalStepSupport';
import { applyAttachStep } from './oracleIRExecutorAttachStepHandlers';
import {
  applyAddCounterStep,
  applyAddTypesStep,
  applyDoubleCountersStep,
  applyGrantLeaveBattlefieldReplacementStep,
  applyGrantTemporaryAbilityStep,
  applyGrantTemporaryDiesTriggerStep,
  applyPhaseOutStep,
  applyRemoveFromCombatStep,
  applyRemoveMarkedDamageStep,
  applyRemoveCounterStep,
  applyMoveCountersStep,
  applyTapMatchingPermanentsStep,
  applyTapOrUntapStep,
  applySetBasicLandTypeStep,
} from './oracleIRExecutorBattlefieldStepHandlers';
import {
  applyDamageCantBePreventedStep,
  applyDealDamageStep,
  applyPreventDamageStep,
} from './oracleIRExecutorDamageStepHandlers';
import { evaluateModifyPtCondition } from './oracleIRExecutorModifyPtCondition';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import {
  applyModifyPtPerRevealedStep,
  applySetBasePtStep,
  applyModifyPtStep,
  applySwitchPowerToughnessStep,
} from './oracleIRExecutorModifyPtStepHandlers';
import { applyMoveZoneStep } from './oracleIRExecutorMoveZoneStepHandlers';
import {
  applyAddPlayerCounterStep,
  applyDoublePlayerCountersStep,
  applyDiscardStep,
  applyRegisterLoseGameReplacementStep,
  applyGainLifeStep,
  applyLoseLifeStep,
  applyLookHandStep,
  applyMillStep,
  applyRevealHandStep,
} from './oracleIRExecutorPlayerStepHandlers';
import { applyCreateTokenStep } from './oracleIRExecutorTokenStepHandlers';
import { resolvePlayers } from './oracleIRExecutorPlayerUtils';
import type {
  MainLoopApplyHandledFn,
  MainLoopApplyModifyPtFn,
  MainLoopRecordSkippedFn,
  MainLoopSetLastStepOutcomeFn,
  MainLoopStepFamilyCtx,
} from './oracleIRExecutorMainLoopStepTypes';
import {
  flushMainLoopFamilyMutableState,
  pickMainLoopFamilyCore,
} from './oracleIRExecutorMainLoopStepTypes';

export function tryApplyMainLoopMillPtTokenSteps(
  ctx: MainLoopStepFamilyCtx,
  step: OracleEffectStep,
): true | undefined {
  const startNextState = ctx.nextState;
  let nextState = ctx.nextState;
  let currentCtx = ctx.currentCtx;
  let lastRevealedCardCount = ctx.lastRevealedCardCount;
  let lastDiscardedCardCount = ctx.lastDiscardedCardCount;
  let lastGreatestDiscardedCardCount = ctx.lastGreatestDiscardedCardCount;
  let lastDiscardedCards = ctx.lastDiscardedCards;
  let lastExiledCardCount = ctx.lastExiledCardCount;
  let lastExiledCards = ctx.lastExiledCards;
  let lastGrantedGraveyardCards = ctx.lastGrantedGraveyardCards;
  let lastGrantedGraveyardPermissionIds = ctx.lastGrantedGraveyardPermissionIds;
  let lastMovedCards = ctx.lastMovedCards;
  let lastMilledCards = ctx.lastMilledCards;
  let lastMovedBattlefieldPermanentIds = ctx.lastMovedBattlefieldPermanentIds;
  let lastCreatedTokenIds = ctx.lastCreatedTokenIds;
  let lastGoadedCreatures = ctx.lastGoadedCreatures;
  let lastSacrificedCreaturesPowerTotal = ctx.lastSacrificedCreaturesPowerTotal;
  let lastSacrificedPermanents = ctx.lastSacrificedPermanents;
  let lastExcessDamageDealtThisWay = ctx.lastExcessDamageDealtThisWay;
  let lastScryLookedAtCount = ctx.lastScryLookedAtCount;
  let lastTappedMatchingPermanentCount = ctx.lastTappedMatchingPermanentCount;
  let lastReferenceAmount = ctx.lastReferenceAmount;
  let lastMovedCountByPlayer = ctx.lastMovedCountByPlayer;
  let lastClashWon = ctx.lastClashWon;
  let lastCollectedEvidence = ctx.lastCollectedEvidence;
  let lastSetInMotionScheme = ctx.lastSetInMotionScheme;
  let lastStepOutcome = ctx.lastStepOutcome;
  let lastActionOutcome = ctx.lastActionOutcome;
  let lastConditionalEvaluation = ctx.lastConditionalEvaluation;
  let replayMutations = ctx.replayMutations;
  let anyConditionalProducedSteps = ctx.anyConditionalProducedSteps;
  let haltedForPlayerChoice = ctx.haltedForPlayerChoice;
  let pendingContinuationSteps = ctx.pendingContinuationSteps;
  let automationGapSequence = ctx.automationGapSequence;
  const controllerId = ctx.controllerId;
  const log = ctx.log;
  const appliedSteps = ctx.appliedSteps;
  const skippedSteps = ctx.skippedSteps;
  const localAutomationGaps = ctx.localAutomationGaps;
  const automationGaps = ctx.automationGaps;
  const pendingOptionalSteps = ctx.pendingOptionalSteps;
  const falseConditionalMarkers = ctx.falseConditionalMarkers;
  const recurse = ctx.recurse;
  const options = ctx.options;
  const absorbExecutionReplayMutations = ctx.absorbExecutionReplayMutations;
  const mergeNestedExecutionOutcome = ctx.mergeNestedExecutionOutcome;

  const flushLets = (): void => {
    flushMainLoopFamilyMutableState(ctx, {
      nextState,
      currentCtx,
      lastRevealedCardCount,
      lastDiscardedCardCount,
      lastGreatestDiscardedCardCount,
      lastDiscardedCards,
      lastExiledCardCount,
      lastExiledCards,
      lastGrantedGraveyardCards,
      lastGrantedGraveyardPermissionIds,
      lastMovedCards,
      lastMilledCards,
      lastMovedBattlefieldPermanentIds,
      lastCreatedTokenIds,
      lastGoadedCreatures,
      lastSacrificedCreaturesPowerTotal,
      lastSacrificedPermanents,
      lastExcessDamageDealtThisWay,
      lastScryLookedAtCount,
      lastTappedMatchingPermanentCount,
      lastReferenceAmount,
      lastMovedCountByPlayer,
      lastClashWon,
      lastCollectedEvidence,
      lastSetInMotionScheme,
      lastStepOutcome,
      lastActionOutcome,
      lastConditionalEvaluation,
      replayMutations,
      anyConditionalProducedSteps,
      haltedForPlayerChoice,
      pendingContinuationSteps,
      automationGapSequence,
    }, startNextState);
  };

  const applyHandledStepResult: MainLoopApplyHandledFn = (handledStep, result, onApplied) => {
    const ok = ctx.applyHandledStepResult(handledStep, result, (appliedResult) => {
      ({
        nextState,
        currentCtx,
        lastMovedCards,
        lastScryLookedAtCount,
        lastReferenceAmount,
        lastStepOutcome,
        lastActionOutcome,
        replayMutations,
        haltedForPlayerChoice,
        automationGapSequence,
      } = pickMainLoopFamilyCore(ctx));
      onApplied?.(appliedResult);
      flushLets();
    });
    ({
      nextState,
      currentCtx,
      lastMovedCards,
      lastScryLookedAtCount,
      lastReferenceAmount,
      lastStepOutcome,
      lastActionOutcome,
      replayMutations,
      haltedForPlayerChoice,
      automationGapSequence,
    } = pickMainLoopFamilyCore(ctx));
    return ok;
  };

  const recordSkippedStep: MainLoopRecordSkippedFn = (handledStep, message, reasonCode, skipOptions) => {
    flushLets();
    ctx.recordSkippedStep(handledStep, message, reasonCode, skipOptions);
    ({
      nextState,
      currentCtx,
      lastMovedCards,
      lastScryLookedAtCount,
      lastReferenceAmount,
      lastStepOutcome,
      lastActionOutcome,
      replayMutations,
      haltedForPlayerChoice,
      automationGapSequence,
    } = pickMainLoopFamilyCore(ctx));
  };

  const setLastStepOutcome: MainLoopSetLastStepOutcomeFn = (handledStep, kind, metadata) => {
    flushLets();
    ctx.setLastStepOutcome(handledStep, kind, metadata);
    ({
      nextState,
      currentCtx,
      lastMovedCards,
      lastScryLookedAtCount,
      lastReferenceAmount,
      lastStepOutcome,
      lastActionOutcome,
      replayMutations,
      haltedForPlayerChoice,
      automationGapSequence,
    } = pickMainLoopFamilyCore(ctx));
  };

  const applyModifyPtStepResult: MainLoopApplyModifyPtFn = (handledStep, result) => {
    flushLets();
    const ok = ctx.applyModifyPtStepResult(handledStep, result);
    ({
      nextState,
      currentCtx,
      lastMovedCards,
      lastScryLookedAtCount,
      lastReferenceAmount,
      lastStepOutcome,
      lastActionOutcome,
      replayMutations,
      haltedForPlayerChoice,
      automationGapSequence,
    } = pickMainLoopFamilyCore(ctx));
    return ok;
  };

  switch (step.kind) {
      case 'mill': {
        const result = applyMillStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (typeof appliedResult.lastRevealedCardCount === 'number') {
            lastRevealedCardCount = Math.max(0, Number(appliedResult.lastRevealedCardCount) || 0);
          }
          if (Array.isArray(appliedResult.lastMilledCards) && appliedResult.lastMilledCards.length > 0) {
            lastMilledCards = [...appliedResult.lastMilledCards];
            currentCtx = { ...currentCtx, lastMilledCards };
          }
        });
        break;
      }
      case 'modify_pt': {
        const result = applyModifyPtStep(
          nextState,
          step,
          currentCtx,
          controllerId,
          {
            lastRevealedCardCount,
            lastDiscardedCardCount,
            lastDiscardedCards,
            lastExiledCardCount,
            lastExiledCards,
            lastMovedCards,
            lastGoadedCreatures,
            lastSacrificedCreaturesPowerTotal,
            lastSacrificedPermanents,
            lastExcessDamageDealtThisWay,
            lastScryLookedAtCount,
            lastTappedMatchingPermanentCount,
          },
          (s, cid, whereRaw, targetId, stepCtx, stepRuntime) =>
            evaluateModifyPtWhereX(s, cid, whereRaw, targetId, stepCtx, stepRuntime, 0, step),
          (state, actingControllerId, conditionRaw) => {
            const fromModifyPt = evaluateModifyPtCondition(state, actingControllerId, conditionRaw);
            if (fromModifyPt !== null) return fromModifyPt;
            return evaluateConditionalWrapperCondition({
              condition: { kind: 'if', raw: conditionRaw },
              nextState: state,
              controllerId: actingControllerId,
              ctx: currentCtx,
              lastActionOutcome,
              lastStepOutcome,
              lastConditionalEvaluation,
              lastMovedCards,
              lastDiscardedCards,
              lastCreatedTokenIds,
              lastExcessDamageDealtThisWay,
            });
          }
        );
        applyModifyPtStepResult(step, result);
        break;
      }
      case 'set_base_pt': {
        const result = applySetBasePtStep(nextState, step, currentCtx);
        applyModifyPtStepResult(step, result);
        break;
      }
      case 'switch_power_toughness': {
        const result = applySwitchPowerToughnessStep(nextState, step, currentCtx);
        applyModifyPtStepResult(step, result);
        break;
      }
      case 'modify_pt_per_revealed': {
        const result = applyModifyPtPerRevealedStep(nextState, step, currentCtx, lastRevealedCardCount);
        applyModifyPtStepResult(step, result);
        break;
      }
      case 'discard': {
        const result = applyDiscardStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastDiscardedCardCount = Math.max(0, Number(appliedResult.lastDiscardedCardCount) || 0);
          lastGreatestDiscardedCardCount = Math.max(
            0,
            Number(appliedResult.lastGreatestDiscardedCardCount ?? appliedResult.lastDiscardedCardCount) || 0,
          );
          lastDiscardedCards = Array.isArray(appliedResult.lastDiscardedCards)
            ? [...appliedResult.lastDiscardedCards]
            : [];
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          lastReferenceAmount = lastDiscardedCardCount;
          currentCtx = {
            ...currentCtx,
            lastDiscardedCards,
            lastMovedCards,
            referenceAmount: lastReferenceAmount,
            lastGreatestDiscardedCardCount,
          };
        });
        break;
      }
      case 'reveal_hand': {
        const result = applyRevealHandStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (typeof appliedResult.lastRevealedCardCount === 'number') {
            lastRevealedCardCount = Math.max(0, Number(appliedResult.lastRevealedCardCount) || 0);
          }
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
            currentCtx = { ...currentCtx, lastMovedCards };
          }
          const revealedPlayers = resolvePlayers(nextState, step.who, currentCtx);
          if (revealedPlayers.length === 1) {
            currentCtx = {
              ...currentCtx,
              selectorContext: {
                ...(currentCtx.selectorContext || {}),
                targetPlayerId: revealedPlayers[0],
                ...(step.who.kind === 'target_opponent'
                  ? { targetOpponentId: revealedPlayers[0] }
                  : {}),
              },
            };
          }
        });
        break;
      }
      case 'look_hand': {
        const result = applyLookHandStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'register_lose_game_replacement': {
        const result = applyRegisterLoseGameReplacementStep(nextState, step, currentCtx, controllerId);
        applyHandledStepResult(step, result);
        break;
      }
      case 'gain_life': {
        const result = applyGainLifeStep(
          nextState,
          step,
          currentCtx,
          controllerId,
          {
            lastRevealedCardCount,
            lastDiscardedCardCount,
            lastDiscardedCards,
            lastExiledCardCount,
            lastExiledCards,
            lastMovedCards,
            lastGoadedCreatures,
            lastSacrificedCreaturesPowerTotal,
            lastSacrificedPermanents,
            lastExcessDamageDealtThisWay,
            lastScryLookedAtCount,
            lastTappedMatchingPermanentCount,
            lastReferenceAmount,
          },
          evaluateModifyPtWhereX
        );
        applyHandledStepResult(step, result);
        break;
      }
      case 'lose_life': {
        const result = applyLoseLifeStep(
          nextState,
          step,
          currentCtx,
          controllerId,
          {
            lastRevealedCardCount,
            lastDiscardedCardCount,
            lastDiscardedCards,
            lastExiledCardCount,
            lastExiledCards,
            lastMovedCards,
            lastGoadedCreatures,
            lastSacrificedCreaturesPowerTotal,
            lastSacrificedPermanents,
            lastExcessDamageDealtThisWay,
            lastScryLookedAtCount,
            lastTappedMatchingPermanentCount,
            lastReferenceAmount,
          },
          evaluateModifyPtWhereX
        );
        applyHandledStepResult(step, result);
        break;
      }
      case 'add_player_counter': {
        const result = applyAddPlayerCounterStep(
          nextState,
          step,
          currentCtx,
          controllerId,
          {
            lastRevealedCardCount,
            lastDiscardedCardCount,
            lastDiscardedCards,
            lastExiledCardCount,
            lastExiledCards,
            lastMovedCards,
            lastGoadedCreatures,
            lastSacrificedCreaturesPowerTotal,
            lastSacrificedPermanents,
            lastExcessDamageDealtThisWay,
            lastScryLookedAtCount,
            lastTappedMatchingPermanentCount,
          },
          evaluateModifyPtWhereX
        );
        applyHandledStepResult(step, result);
        break;
      }
      case 'double_player_counters': {
        const result = applyDoublePlayerCountersStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'deal_damage': {
        const result = applyDealDamageStep(nextState, step, currentCtx, {
          lastMovedCards,
          lastDiscardedCards,
          lastExiledCards,
          lastSacrificedPermanents,
          lastTappedMatchingPermanentCount,
          lastReferenceAmount,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExcessDamageDealtThisWay = Math.max(0, Number(appliedResult.excessDamageDealtThisWay) || 0);
        });
        break;
      }
      case 'prevent_damage': {
        const result = applyPreventDamageStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'damage_cant_be_prevented': {
        const result = applyDamageCantBePreventedStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'remove_marked_damage': {
        const result = applyRemoveMarkedDamageStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'tap_or_untap': {
        const result = applyTapOrUntapStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (typeof appliedResult.lastTappedMatchingPermanentCount === 'number') {
            lastTappedMatchingPermanentCount = Math.max(0, appliedResult.lastTappedMatchingPermanentCount);
          }
          const tappedIds = Array.isArray(appliedResult.lastTappedMatchingPermanentIds)
            ? appliedResult.lastTappedMatchingPermanentIds
                .map((id: unknown) => String(id || '').trim())
                .filter(Boolean)
            : [];
          if (tappedIds.length > 0) {
            currentCtx = {
              ...currentCtx,
              selectorContext: {
                ...(currentCtx.selectorContext || {}),
                chosenObjectIds: tappedIds,
              },
            };
          }
        });
        break;
      }
      case 'remove_from_combat': {
        const result = applyRemoveFromCombatStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'phase_out': {
        const result = applyPhaseOutStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'tap_matching_permanents': {
        const result = applyTapMatchingPermanentsStep(nextState, step, currentCtx);
        if ('message' in result) {
          recordSkippedStep(step, result.message, result.reason, result.options);
          break;
        }

        nextState = result.state;
        lastTappedMatchingPermanentCount = Math.max(0, Number(result.lastTappedMatchingPermanentCount) || 0);
        const tappedIds = Array.isArray(result.lastTappedMatchingPermanentIds)
          ? result.lastTappedMatchingPermanentIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
          : [];
        setLastStepOutcome(step, 'applied', { count: lastTappedMatchingPermanentCount });
        if (tappedIds.length > 0) {
          currentCtx = {
            ...currentCtx,
            selectorContext: {
              ...(currentCtx.selectorContext || {}),
              chosenObjectIds: Array.from(
                new Set([
                  ...(Array.isArray(currentCtx.selectorContext?.chosenObjectIds)
                    ? currentCtx.selectorContext.chosenObjectIds
                    : []),
                  ...tappedIds,
                ])
              ),
            },
          };
        }
        log.push(...result.log);
        appliedSteps.push(step);
        break;
      }
      case 'remove_counter': {
        const result = applyRemoveCounterStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'move_counters': {
        const result = applyMoveCountersStep(nextState, step, currentCtx, {
          lastSacrificedPermanents,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'add_counter': {
        const result = applyAddCounterStep(nextState, step, currentCtx, {
          lastCreatedTokenIds,
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
          lastDiscardedCards,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards) ? [...appliedResult.lastMovedCards] : lastMovedCards;
          lastMovedBattlefieldPermanentIds = Array.isArray(appliedResult.lastMovedBattlefieldPermanentIds)
            ? [...appliedResult.lastMovedBattlefieldPermanentIds]
            : lastMovedBattlefieldPermanentIds;
          const referencedPermanentId = lastMovedBattlefieldPermanentIds.length > 0
            ? String(lastMovedBattlefieldPermanentIds[lastMovedBattlefieldPermanentIds.length - 1] || '').trim()
            : '';
          currentCtx = {
            ...currentCtx,
            lastMovedCards,
            lastMovedBattlefieldPermanentIds,
            ...(referencedPermanentId ? { lastReferencedPermanentId: referencedPermanentId } : {}),
          };
        });
        break;
      }
      case 'add_types': {
        const result = applyAddTypesStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'set_basic_land_type': {
        const result = applySetBasicLandTypeStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'double_counters': {
        const result = applyDoubleCountersStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'move_zone': {
        const result = applyMoveZoneStep(nextState, step, currentCtx, {
          lastMovedCards,
          lastExiledCards,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
            if (step.to === 'exile' || /\bexile\b/i.test(String(step.toRaw || ''))) {
              lastExiledCards = [...appliedResult.lastMovedCards];
              lastExiledCardCount = appliedResult.lastMovedCards.length;
            }
          }
          if (typeof appliedResult.lastReferenceAmount === 'number' && Number.isFinite(appliedResult.lastReferenceAmount)) {
            lastReferenceAmount = Math.max(0, Number(appliedResult.lastReferenceAmount) || 0);
          }
          if (appliedResult.lastMovedCountByPlayer) {
            lastMovedCountByPlayer = { ...appliedResult.lastMovedCountByPlayer };
          }
          lastMovedBattlefieldPermanentIds = Array.isArray(appliedResult.lastMovedBattlefieldPermanentIds)
            ? [...appliedResult.lastMovedBattlefieldPermanentIds]
            : [];
          currentCtx = {
            ...currentCtx,
            lastMovedCards,
            ...(lastExiledCards.length > 0 ? { lastExiledCards } : {}),
            lastMovedBattlefieldPermanentIds,
            ...(typeof lastReferenceAmount === 'number' && Number.isFinite(lastReferenceAmount)
              ? { referenceAmount: lastReferenceAmount }
              : {}),
            ...(lastMovedCountByPlayer ? { lastMovedCountByPlayer } : {}),
          };
        });
        break;
      }
      case 'attach': {
        const result = applyAttachStep(nextState, step, currentCtx, lastMovedBattlefieldPermanentIds);
        applyHandledStepResult(step, result);
        break;
      }
      case 'create_token': {
        const result = applyCreateTokenStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
          lastMilledCards,
          lastReferenceAmount,
          lastSacrificedPermanents,
          lastCreatedTokenIds,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          lastCreatedTokenIds = Array.isArray(appliedResult.createdTokenIds)
            ? appliedResult.createdTokenIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
            : [];
          if (lastCreatedTokenIds.length <= 0) return;
          lastMovedBattlefieldPermanentIds = [...lastCreatedTokenIds];
          currentCtx = {
            ...currentCtx,
            lastMovedBattlefieldPermanentIds,
            selectorContext: {
              ...(currentCtx.selectorContext || {}),
              chosenObjectIds: Array.from(
                new Set([
                  ...((currentCtx.selectorContext?.chosenObjectIds || []) as readonly string[]),
                  ...lastCreatedTokenIds,
                ].map((id: unknown) => String(id || '').trim()).filter(Boolean))
              ),
            },
          };
        });
        break;
      }
      case 'grant_temporary_dies_trigger': {
        const result = applyGrantTemporaryDiesTriggerStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'grant_temporary_ability': {
        const result = applyGrantTemporaryAbilityStep(nextState, step, currentCtx, {
          lastCreatedTokenIds,
          lastMovedBattlefieldPermanentIds,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'grant_leave_battlefield_replacement': {
        const result = applyGrantLeaveBattlefieldReplacementStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
        });
        applyHandledStepResult(step, result);
        break;
      }
    default:
      return undefined;
  }
  flushLets();
  return true;
}
