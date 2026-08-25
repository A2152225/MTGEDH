// Origin parent: oracleIRExecutorMainLoop.ts
// Cluster moved: applyOracleIRStepsToGameStateImpl switch cases player_choice through
// put_on_bottom (player choice, keywords, look/scry/explore/connive).
// Public entry symbol: tryApplyMainLoopChoiceKeywordLookSteps.

import type { OracleEffectStep } from './oracleIR';
import { resolveSingleCreatureTargetId } from './oracleIRExecutorCreatureStepUtils';
import {
  applyGainClassLevelStep,
  applyMonstrosityStep,
  applyBecomeRenownedStep,
  applyCopyPermanentStep,
  applySuspectStep,
  applyTurnFaceDownStep,
  applyTurnFaceUpStep,
} from './oracleIRExecutorBattlefieldStepHandlers';
import {
  applyBlightStep,
  applyInvestigateStep,
  applyPopulateStep,
  applyProliferateStep,
  applyRingTemptsYouStep,
  applyTimeTravelStep,
} from './oracleIRExecutorKeywordStepHandlers';
import {
  applyConniveStep,
  applyCreateEmblemStep,
  applyExploreStep,
  applyFatesealStep,
  applyManifestDreadStep,
  applyRedistributeLifeTotalsStep,
  applyLookChooseFromTopStep,
  applyLookTopStep,
  applyPutOnBottomStep,
  applyRevealTopStep,
  applyLookSelectTopStep,
  applyScryStep,
  applySurveilStep,
  applyVoteStep,
} from './oracleIRExecutorPlayerStepHandlers';
import { resolveAntecedentContextualCards } from './oracleIRLedgerCardAccess';
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

export function tryApplyMainLoopChoiceKeywordLookSteps(
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
      case 'player_choice': {
        if (step.choice === 'letter') {
          const chosenLetter = String(currentCtx.selectorContext?.chosenLetter || '').trim();
          if (!chosenLetter) {
            recordSkippedStep(
              step,
              `Skipped player choice (${step.choice}): ${step.raw}`,
              'player_choice_required',
              {
                classification: 'player_choice',
                metadata: {
                  choice: step.choice,
                  options: Array.isArray(step.options) ? [...step.options] : undefined,
                },
              }
            );
            break;
          }

          currentCtx = {
            ...currentCtx,
            selectorContext: {
              ...(currentCtx.selectorContext || {}),
              chosenLetter: chosenLetter.slice(0, 1),
            },
          };
          setLastStepOutcome(step, 'applied');
          log.push(`Chose letter ${chosenLetter.slice(0, 1).toUpperCase()}`);
          appliedSteps.push(step);
          break;
        }

        if (step.choice === 'odd_even') {
          const chosenOddEven = String(currentCtx.selectorContext?.chosenOddEven || '').trim().toLowerCase();
          if (chosenOddEven !== 'odd' && chosenOddEven !== 'even') {
            recordSkippedStep(
              step,
              `Skipped player choice (${step.choice}): ${step.raw}`,
              'player_choice_required',
              {
                classification: 'player_choice',
                metadata: {
                  choice: step.choice,
                  options: Array.isArray(step.options) ? [...step.options] : undefined,
                },
              }
            );
            break;
          }

          currentCtx = {
            ...currentCtx,
            selectorContext: {
              ...(currentCtx.selectorContext || {}),
              chosenOddEven: chosenOddEven as 'odd' | 'even',
            },
          };
          setLastStepOutcome(step, 'applied');
          log.push(`Chose ${chosenOddEven}`);
          appliedSteps.push(step);
          break;
        }

        {
          const isKeywordCounterFromAmongChoice =
            step.choice === 'generic'
            && /counter from among/i.test(String(step.raw || ''))
            && Array.isArray(step.options)
            && step.options.length > 0;
          if (isKeywordCounterFromAmongChoice) {
            recordSkippedStep(
              step,
              `Skipped player choice (${step.choice}): ${step.raw}`,
              'player_choice_required',
              {
                classification: 'player_choice',
                metadata: {
                  choice: step.choice,
                  options: Array.isArray(step.options) ? [...step.options] : undefined,
                },
              },
            );
            break;
          }

          const chosenObjectIds = Array.isArray(currentCtx.selectorContext?.chosenObjectIds)
            ? currentCtx.selectorContext.chosenObjectIds.map((id) => String(id || '').trim()).filter(Boolean)
            : [];
          const normalizedChoiceRaw = String(step.raw || '')
            .replace(/\u2019/g, "'")
            .trim()
            .toLowerCase();
          const amongThemChoice = /\bfrom among them\b/.test(normalizedChoiceRaw);
          const contextualCardIds = amongThemChoice
            ? new Set(
                (resolveAntecedentContextualCards(currentCtx) as any[])
                  .map((card) => String(card?.id || '').trim())
                  .filter(Boolean),
              )
            : null;
          const validAmongThemChoice =
            !amongThemChoice
            || (
              chosenObjectIds.length > 0
              && chosenObjectIds.every((id) => contextualCardIds?.has(id))
            );
          const exactCountMatch = normalizedChoiceRaw.match(
            /^choose exactly (two|three|four|five|\d+) (?:target )?(?:creatures|creature cards|cards|permanents)(?: you control)?$/
          );
          const requiredCount = exactCountMatch
            ? ({ two: 2, three: 3, four: 4, five: 5 } as Record<string, number>)[String(exactCountMatch[1] || '').toLowerCase()] ??
              Number(exactCountMatch[1])
            : null;
          if (
            validAmongThemChoice &&
            chosenObjectIds.length > 0 &&
            (requiredCount === null || chosenObjectIds.length >= requiredCount)
          ) {
            const boundIds =
              requiredCount === null ? chosenObjectIds : chosenObjectIds.slice(0, Math.max(0, requiredCount));
            currentCtx = {
              ...currentCtx,
              selectorContext: {
                ...(currentCtx.selectorContext || {}),
                chosenObjectIds: boundIds,
              },
            };
            setLastStepOutcome(step, 'applied');
            log.push(`Chose ${boundIds.length} object(s) for player choice: ${step.raw}`);
            appliedSteps.push(step);
            break;
          }
        }

        recordSkippedStep(
          step,
          `Skipped player choice (${step.choice}): ${step.raw}`,
          'player_choice_required',
          {
            classification: 'player_choice',
            metadata: {
              choice: step.choice,
              options: Array.isArray(step.options) ? [...step.options] : undefined,
            },
          }
        );
        break;
      }
      case 'choose_target_creature': {
        const chosenTargetId = String(resolveSingleCreatureTargetId(nextState, step.target, currentCtx) || '').trim();
        if (!chosenTargetId) {
          recordSkippedStep(
            step,
            `Skipped choose target creature (requires player choice): ${step.raw}`,
            'player_choice_required',
            {
              classification: 'player_choice',
            }
          );
          break;
        }

        currentCtx = {
          ...currentCtx,
          targetCreatureId: chosenTargetId,
          targetPermanentId: chosenTargetId,
        };
        setLastStepOutcome(step, 'applied');
        log.push(`Chose target creature ${chosenTargetId}`);
        appliedSteps.push(step);
        break;
      }
      case 'create_emblem': {
        const result = applyCreateEmblemStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'proliferate': {
        const result = applyProliferateStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'redistribute_life_totals': {
        const result = applyRedistributeLifeTotalsStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'investigate': {
        const result = applyInvestigateStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'blight': {
        const result = applyBlightStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'populate': {
        const result = applyPopulateStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'paradigm': {
        setLastStepOutcome(step, 'applied');
        log.push(`Registered paradigm: ${step.raw}`);
        appliedSteps.push(step);
        break;
      }
      case 'ring_tempts_you': {
        const result = applyRingTemptsYouStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'time_travel': {
        const result = applyTimeTravelStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'suspect': {
        const result = applySuspectStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'become_renowned': {
        const result = applyBecomeRenownedStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'gain_class_level': {
        const result = applyGainClassLevelStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'monstrosity': {
        const result = applyMonstrosityStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'turn_face_up': {
        const result = applyTurnFaceUpStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'turn_face_down': {
        const result = applyTurnFaceDownStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
          lastDiscardedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'copy_permanent': {
        const result = applyCopyPermanentStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'scry': {
        const result = applyScryStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastScryLookedAtCount = Math.max(0, Number(appliedResult.lastScryLookedAtCount) || 0);
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
            currentCtx = { ...currentCtx, lastMovedCards };
          }
        });
        break;
      }
      case 'surveil': {
        const result = applySurveilStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
            currentCtx = { ...currentCtx, lastMovedCards };
          }
        });
        break;
      }
      case 'fateseal': {
        const result = applyFatesealStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'vote': {
        const result = applyVoteStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'look_top': {
        const result = applyLookTopStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (appliedResult.lastTopLibraryOwnerId) {
            currentCtx = { ...currentCtx, lastTopLibraryOwnerId: appliedResult.lastTopLibraryOwnerId };
          }
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
            currentCtx = { ...currentCtx, lastMovedCards };
          }
        });
        break;
      }
      case 'reveal_top': {
        const result = applyRevealTopStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (typeof appliedResult.lastRevealedCardCount === 'number') {
            lastRevealedCardCount = Math.max(0, Number(appliedResult.lastRevealedCardCount) || 0);
          }
          if (appliedResult.lastTopLibraryOwnerId) {
            currentCtx = { ...currentCtx, lastTopLibraryOwnerId: appliedResult.lastTopLibraryOwnerId };
          }
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
            currentCtx = { ...currentCtx, lastMovedCards };
          }
          if (Array.isArray((appliedResult as any).lastRevealedCards) && (appliedResult as any).lastRevealedCards.length > 0) {
            currentCtx = {
              ...currentCtx,
              lastRevealedCards: [...(appliedResult as any).lastRevealedCards],
            };
          } else if (lastRevealedCardCount > 0 && Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            currentCtx = {
              ...currentCtx,
              lastRevealedCards: [...appliedResult.lastMovedCards],
            };
          }
        });
        break;
      }
      case 'look_select_top': {
        const result = applyLookSelectTopStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (Array.isArray(appliedResult.lastMovedCards)) {
            lastMovedCards = [...appliedResult.lastMovedCards];
            currentCtx = { ...currentCtx, lastMovedCards };
          }
        });
        break;
      }
      case 'look_choose_from_top': {
        const result = applyLookChooseFromTopStep(nextState, step, currentCtx, {
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
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          currentCtx = { ...currentCtx, lastMovedCards };
        });
        break;
      }
      case 'explore': {
        const result = applyExploreStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'manifest_dread': {
        const result = applyManifestDreadStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards) ? [...appliedResult.lastMovedCards] : lastMovedCards;
          currentCtx = { ...currentCtx, lastMovedCards };
        });
        break;
      }
      case 'connive': {
        const result = applyConniveStep(nextState, step, currentCtx, {
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
          lastDiscardedCardCount = Math.max(0, Number(appliedResult.lastDiscardedCardCount) || 0);
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
          };
        });
        break;
      }
      case 'put_on_bottom': {
        const result = applyPutOnBottomStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
    default:
      return undefined;
  }
  flushLets();
  return true;
}
