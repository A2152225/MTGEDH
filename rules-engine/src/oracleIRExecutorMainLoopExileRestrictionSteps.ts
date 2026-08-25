// Origin parent: oracleIRExecutorMainLoop.ts
// Cluster moved: applyOracleIRStepsToGameStateImpl switch cases exile_top through
// optional_untap_choice (exile permissions, goad/detain/cant_*, airbend/earthbend/animate).
// Public entry symbol: tryApplyMainLoopExileRestrictionSteps.

import type { OracleEffectStep } from './oracleIR';
import {
  applyCantAttackStep,
  applyCantActivateAbilitiesStep,
  applyCantBlockStep,
  applyForceBlockStep,
  applyDetainStep,
  applyAirbendStep,
  applyEarthbendStep,
  applyAnimatePermanentStep,
  applyExertStep,
  applyOptionalUntapChoiceStep,
  applySkipNextUntapStep,
} from './oracleIRExecutorBattlefieldStepHandlers';
import {
  applyExileTopStep,
  applyGrantExilePermissionStep,
  applyImpulseExileTopStep,
  applyModifyExilePermissionsStep,
} from './oracleIRExecutorExileStepHandlers';
import { applyGrantFutureSpellEffectStep } from './oracleIRExecutorFutureSpellStepHandlers';
import { applyGoadStep } from './oracleIRExecutorGoadStepHandlers';
import type { MainLoopApplyHandledFn, MainLoopStepFamilyCtx } from './oracleIRExecutorMainLoopStepTypes';
import {
  flushMainLoopFamilyMutableState,
  pickMainLoopFamilyCore,
} from './oracleIRExecutorMainLoopStepTypes';

export function tryApplyMainLoopExileRestrictionSteps(
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

  switch (step.kind) {
      case 'exile_top': {
        const result = applyExileTopStep(nextState, step, currentCtx, {
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
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExiledCardCount = Math.max(0, Number(appliedResult.lastExiledCardCount) || 0);
          if (Array.isArray(appliedResult.lastExiledCards)) {
            lastExiledCards = [...appliedResult.lastExiledCards];
            currentCtx = { ...currentCtx, lastExiledCards };
          }
        });
        break;
      }
      case 'impulse_exile_top': {
        const result = applyImpulseExileTopStep(nextState, step, currentCtx, {
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
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExiledCardCount = Math.max(0, Number(appliedResult.lastExiledCardCount) || 0);
          if (Array.isArray(appliedResult.lastExiledCards)) {
            lastExiledCards = [...appliedResult.lastExiledCards];
            currentCtx = { ...currentCtx, lastExiledCards };
          }
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
          } else if (lastExiledCards.length > 0) {
            lastMovedCards = [...lastExiledCards];
          }
        });
        break;
      }
      case 'modify_exile_permissions': {
        const result = applyModifyExilePermissionsStep(nextState, step, { lastExiledCards }, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'grant_exile_permission': {
        const result = applyGrantExilePermissionStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'grant_future_spell_effect': {
        const result = applyGrantFutureSpellEffectStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'goad': {
        const result = applyGoadStep(nextState, step, currentCtx, controllerId);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastGoadedCreatures = [...appliedResult.lastGoadedCreatures];
          const goadedIds = lastGoadedCreatures
            .map((perm: any) => String(perm?.id || '').trim())
            .filter(Boolean);
          if (goadedIds.length > 0) {
            currentCtx = {
              ...currentCtx,
              lastGoadedBattlefieldPermanentIds: goadedIds,
            };
          }
        });
        break;
      }
      case 'detain': {
        const result = applyDetainStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'cant_attack': {
        const result = applyCantAttackStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'cant_block': {
        const result = applyCantBlockStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'force_block': {
        const result = applyForceBlockStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'cant_activate_abilities': {
        const result = applyCantActivateAbilitiesStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'exert': {
        const result = applyExertStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'airbend': {
        const result = applyAirbendStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExiledCardCount = Math.max(0, Number(appliedResult.lastExiledCardCount) || 0);
          lastExiledCards = Array.isArray(appliedResult.lastExiledCards)
            ? [...appliedResult.lastExiledCards]
            : [];
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
          } else if (lastExiledCards.length > 0) {
            lastMovedCards = [...lastExiledCards];
          }
        });
        break;
      }
      case 'earthbend': {
        const result = applyEarthbendStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'animate_permanent': {
        const result = applyAnimatePermanentStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'skip_next_untap': {
        const result = applySkipNextUntapStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'optional_untap_choice': {
        const result = applyOptionalUntapChoiceStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
    default:
      return undefined;
  }
  flushLets();
  return true;
}
