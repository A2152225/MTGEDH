// Origin parent: oracleIRExecutorMainLoop.ts
// Cluster moved: applyOracleIRStepsToGameStateImpl switch cases copy_chapter_ability
// through destroy (copy spell/chapter, delayed trigger, destroy).
// Public entry symbol: tryApplyMainLoopCopyDestroySteps.

import type { OracleAutomationGap } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { createOracleAutomationGapRecord } from './oracleIRAutomationGaps';
import {
  bindCopiedStackSpellTargetsToContext,
  getCopiedChapterAbilityReplaySteps,
  getCopiedSpellReplaySteps,
  getCopiedStackObjectReplaySteps,
  payCopiedSpellCastCost,
  prepareCopiedSpellExecutionContext,
  resolveCopySpellCount,
  resolveCopiedTargetSpellStackItem,
  resolveCopiedSpellSourceCards,
  resolveThisSpellCopyReplaySteps,
  shouldDeferStackSpellCopyToServer,
  createCastableCopiedSpellCards,
} from './oracleIRExecutorCopySpellSupport';
import {
  applyDestroyStep,
  applyScheduleDelayedTriggerStep,
} from './oracleIRExecutorBattlefieldStepHandlers';
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

export function tryApplyMainLoopCopyDestroySteps(
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
  const steps = ctx.steps;
  const stepIndex = ctx.stepIndex;
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
      case 'copy_chapter_ability': {
        if (lastMovedCards.length !== 1) {
          recordSkippedStep(
            step,
            `Skipped copied chapter ability (no moved Saga card available): ${step.raw}`,
            'invalid_copy_spell_source',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        const movedCard = lastMovedCards[0] as any;
        const replayableSteps = getCopiedChapterAbilityReplaySteps(movedCard, step.chapter);
        if (replayableSteps.length === 0) {
          recordSkippedStep(
            step,
            `Skipped copied chapter ability (no deterministic chapter steps): ${step.raw}`,
            'invalid_copy_spell_source',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        const replayCtx: OracleIRExecutionContext = {
          ...currentCtx,
          sourceId: String(movedCard?.id || movedCard?.card?.id || currentCtx.sourceId || '').trim() || currentCtx.sourceId,
          sourceName: String(movedCard?.name || movedCard?.card?.name || currentCtx.sourceName || '').trim() || currentCtx.sourceName,
          castFromZone: undefined,
          enteredFromZone: undefined,
        };

        const replayResult = recurse(nextState, replayableSteps, replayCtx, options);
        nextState = replayResult.state;
        setLastStepOutcome(step, 'applied');
        log.push(
          `[oracle-ir] Replayed copied chapter ${step.chapter} ability from ${String(movedCard?.name || movedCard?.card?.name || 'copied Saga')}`
        );
        log.push(...replayResult.log);
        appliedSteps.push(...replayResult.appliedSteps);
        skippedSteps.push(...replayResult.skippedSteps);
        appliedSteps.push(step);
        automationGaps.push(...replayResult.automationGaps);
        pendingOptionalSteps.push(...replayResult.pendingOptionalSteps);
        absorbExecutionReplayMutations(replayResult);
        break;
      }
      case 'copy_spell': {
        if (shouldDeferStackSpellCopyToServer(currentCtx, step)) {
          // Always emit the server bridge gap — even when IR counts 0.
          // Sticky copyCount:0 / missing tax on a transient state must not swallow
          // commander-CZ (Storm suite / Hatut) or storm-count copies; the server
          // re-resolves from authoritative tax / cast ledgers.
          const copyCount = Math.max(0, resolveCopySpellCount(nextState, controllerId, step, currentCtx));
          const deferMessage = copyCount > 0
            ? `Deferred ${copyCount} stack spell cop${copyCount === 1 ? 'y' : 'ies'} to server: ${step.raw}`
            : `Deferred stack spell copy to server for re-resolve (IR count 0): ${step.raw}`;
          const gap = createOracleAutomationGapRecord({
            state: nextState,
            ctx: currentCtx,
            step,
            reasonCode: 'server_stack_copy_required',
            message: deferMessage,
            sequence: ++automationGapSequence,
            classification: 'ambiguous',
            metadata: { copyCount },
          });
          localAutomationGaps.push(gap);
          automationGaps.push(gap);
          appliedSteps.push(step);
          setLastStepOutcome(step, 'applied', { count: copyCount });
          log.push(`[oracle-ir] ${deferMessage}`);
          break;
        }

        if (step.subject === 'this_spell') {
          const replayableSteps = resolveThisSpellCopyReplaySteps({
            steps,
            stepIndex,
            state: nextState,
            ctx: currentCtx,
          });
          if (replayableSteps.length === 0) {
            const copyCount = resolveCopySpellCount(nextState, controllerId, step, currentCtx);
            setLastStepOutcome(step, 'applied', { count: Math.max(1, copyCount) });
            appliedSteps.push(step);
            log.push(`[oracle-ir] Copied spell (implicit resolution): ${step.raw}`);
            break;
          }

          const preparedCopy = prepareCopiedSpellExecutionContext({
            state: nextState,
            replaySteps: replayableSteps,
            ctx: currentCtx,
          });
          if (preparedCopy.requiresChoice) {
            recordSkippedStep(
              step,
              `Skipped copied spell retargeting (requires player choice): ${step.raw}`,
              'player_choice_required',
              {
                classification: 'player_choice',
                metadata: {
                  candidateCount: Number(preparedCopy.candidateCount || 0),
                },
              }
            );
            break;
          }

          const copyCount = resolveCopySpellCount(nextState, controllerId, step, currentCtx);
          if (copyCount <= 0) {
            setLastStepOutcome(step, 'applied', { count: 0 });
            appliedSteps.push(step);
            log.push(`[oracle-ir] Copy spell produced 0 copies: ${step.raw}`);
            break;
          }

          let workingState = nextState;
          for (let copyIndex = 0; copyIndex < copyCount; copyIndex += 1) {
            const replayResult = recurse(workingState, replayableSteps, preparedCopy.ctx, options);
            workingState = replayResult.state;
            log.push(...preparedCopy.log);
            log.push(...replayResult.log);
            automationGaps.push(...replayResult.automationGaps);
            pendingOptionalSteps.push(...replayResult.pendingOptionalSteps);
            absorbExecutionReplayMutations(replayResult);
          }

          nextState = workingState;
          setLastStepOutcome(step, 'applied', { count: copyCount });
          appliedSteps.push(step);
          break;
        }

        if (step.subject === 'target_spell') {
          const targetResolution = resolveCopiedTargetSpellStackItem({
            state: nextState,
            step,
            ctx: currentCtx,
          });
          if (!targetResolution.stackItem) {
            recordSkippedStep(
              step,
              targetResolution.reason === 'player_choice_required'
                ? `Skipped copy spell step (requires stack target choice): ${step.raw}`
                : `Skipped copy spell step (target spell unavailable): ${step.raw}`,
              targetResolution.reason === 'player_choice_required' ? 'player_choice_required' : 'invalid_copy_spell_source',
              {
                classification: targetResolution.reason === 'player_choice_required' ? 'player_choice' : 'invalid_input',
                ...(targetResolution.metadata ? { metadata: targetResolution.metadata as Record<string, string | number | boolean | readonly string[]> } : {}),
                ...(targetResolution.reason === 'invalid_source' ? { persist: false } : {}),
              }
            );
            break;
          }

          const replayableSteps = getCopiedStackObjectReplaySteps(targetResolution.stackItem, step);
          if (replayableSteps.length === 0) {
            recordSkippedStep(
              step,
              `Skipped copy spell step (no deterministic copied spell steps): ${step.raw}`,
              'invalid_copy_spell_source',
              {
                classification: 'invalid_input',
              }
            );
            break;
          }

          const copiedCtx = bindCopiedStackSpellTargetsToContext({
            state: nextState,
            stackItem: targetResolution.stackItem,
            ctx: currentCtx,
          });
          const preparedCopy = prepareCopiedSpellExecutionContext({
            state: nextState,
            replaySteps: replayableSteps,
            ctx: copiedCtx,
          });
          if (preparedCopy.requiresChoice) {
            recordSkippedStep(
              step,
              `Skipped copied spell retargeting (requires player choice): ${step.raw}`,
              'player_choice_required',
              {
                classification: 'player_choice',
                metadata: {
                  candidateCount: Number(preparedCopy.candidateCount || 0),
                },
              }
            );
            break;
          }

          const copyCount = resolveCopySpellCount(nextState, controllerId, step, currentCtx);
          if (copyCount <= 0) {
            setLastStepOutcome(step, 'applied', { count: 0 });
            appliedSteps.push(step);
            log.push(`[oracle-ir] Copy spell produced 0 copies: ${step.raw}`);
            break;
          }

          let workingState = nextState;
          for (let copyIndex = 0; copyIndex < copyCount; copyIndex += 1) {
            const replayResult = recurse(workingState, replayableSteps, preparedCopy.ctx, options);
            workingState = replayResult.state;
            log.push(...preparedCopy.log);
            log.push(...replayResult.log);
            automationGaps.push(...replayResult.automationGaps);
            pendingOptionalSteps.push(...replayResult.pendingOptionalSteps);
            absorbExecutionReplayMutations(replayResult);
          }

          nextState = workingState;
          setLastStepOutcome(step, 'applied', { count: copyCount });
          appliedSteps.push(step);
          break;
        }

        const sourceResolution = resolveCopiedSpellSourceCards({
          state: nextState,
          step,
          ctx: currentCtx,
          lastMovedCards,
        });
        if (!sourceResolution.cards || sourceResolution.cards.length === 0) {
          recordSkippedStep(
            step,
            `Skipped copy spell step (copied source unavailable): ${step.raw}`,
            'invalid_copy_spell_source',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        let workingState = nextState;
        const combinedLog: string[] = [];
        const combinedGaps: OracleAutomationGap[] = [];
        const combinedPendingOptionalSteps: OracleEffectStep[] = [];
        let appliedCopyCount = 0;

        for (const copiedCard of sourceResolution.cards) {
          // "You may cast the copy" is a may-cast, not an auto-replay of the copied
          // card's effects. Deterministic sorceries (Divination) used to skip this
          // branch whenever allowOptional was already true, so combat copies vanished.
          if (step.optional === true) {
            const created = createCastableCopiedSpellCards({
              state: workingState,
              controllerId,
              cards: [copiedCard],
              step,
            });
            workingState = created.state;
            combinedLog.push(...created.log);
            appliedCopyCount += created.createdCards.length;
            continue;
          }
          const replayableSteps = getCopiedSpellReplaySteps(copiedCard);
          if (replayableSteps.length === 0) {
            recordSkippedStep(
              step,
              `Skipped copy spell step (no deterministic copied spell steps): ${step.raw}`,
              'invalid_copy_spell_source',
              {
                classification: 'invalid_input',
              }
            );
            continue;
          }

          const payment = payCopiedSpellCastCost({
            state: workingState,
            controllerId,
            card: copiedCard,
            step,
          });
          if (payment.reason) {
            recordSkippedStep(
              step,
              payment.reason === 'cannot_pay'
                ? `Skipped copy spell step (cannot pay copied spell cost): ${step.raw}`
                : `Skipped copy spell step (unsupported copied spell cost): ${step.raw}`,
              payment.reason === 'cannot_pay' ? 'failed_to_apply' : 'invalid_copy_spell_source',
              {
                classification: payment.reason === 'cannot_pay' ? 'invalid_input' : 'ambiguous',
                persist: false,
              }
            );
            continue;
          }

          workingState = payment.state;
          combinedLog.push(...payment.log);

          const replayCtx: OracleIRExecutionContext = {
            ...currentCtx,
            sourceId: String(copiedCard?.id || copiedCard?.card?.id || currentCtx.sourceId || '').trim() || currentCtx.sourceId,
            sourceName: String(copiedCard?.name || copiedCard?.card?.name || currentCtx.sourceName || '').trim() || currentCtx.sourceName,
            castFromZone: undefined,
            enteredFromZone: undefined,
            copyReplaySteps: replayableSteps,
          };

          const replayResult = recurse(
            workingState,
            replayableSteps,
            replayCtx,
            {
              ...options,
              allowOptional: step.optional ? options.allowOptional : true,
            }
          );
          workingState = replayResult.state;
          combinedLog.push(`[oracle-ir] Replayed copied spell from ${String(copiedCard?.name || copiedCard?.card?.name || 'copied card')}`);
          combinedLog.push(...replayResult.log);
          combinedGaps.push(...replayResult.automationGaps);
          combinedPendingOptionalSteps.push(...replayResult.pendingOptionalSteps);
          absorbExecutionReplayMutations(replayResult);
          appliedCopyCount += 1;
        }

        if (appliedCopyCount === 0) break;

        nextState = workingState;
        setLastStepOutcome(step, 'applied');
        log.push(...combinedLog);
        appliedSteps.push(step);
        automationGaps.push(...combinedGaps);
        pendingOptionalSteps.push(...combinedPendingOptionalSteps);
        break;
      }
      case 'schedule_delayed_trigger': {
        const result = applyScheduleDelayedTriggerStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'destroy': {
        const result = applyDestroyStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
            currentCtx = { ...currentCtx, lastMovedCards };
          }
        });
        break;
      }
    default:
      return undefined;
  }
  flushLets();
  return true;
}
