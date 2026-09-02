// Origin parent: oracleIRExecutorMainLoop.ts
// Cluster moved: applyOracleIRStepsToGameStateImpl switch cases counter_spell through
// default (exile, piles, sacrifice, choose_mode, conditional, unless_*, modify_damage).
// Public entry symbol: tryApplyMainLoopLateSteps.

import type { BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import {
  applyConditionalReferenceAmount,
  evaluateConditionalWrapperCondition,
  resolveConditionalReferenceAmount,
} from './oracleIRExecutorConditionalStepSupport';
import { applyChooseModeStep } from './oracleIRExecutorChooseModeStepHandlers';
import {
  applyExileStep,
  applySacrificeStep,
  evaluateUnlessSacrificesStep,
  applyScheduleDelayedBattlefieldActionStep,
} from './oracleIRExecutorBattlefieldStepHandlers';
import { applyRepeatedZoneDraftStep } from './oracleIRExecutorRepeatedZoneDraft';
import { evaluateAnyPlayerMayStep } from './oracleIRExecutorAnyPlayerMayStep';
import {
  evaluateUnlessPaysLifeStep,
  evaluateUnlessPaysManaStep,
  evaluateUnlessDiscardsStep,
} from './oracleIRExecutorPlayerStepHandlers';
import {
  bindUnlessPaysForEachContext,
  bindUnlessPaysForEachStackContext,
  resolveUnlessPaysForEachPermanentIds,
  resolveUnlessPaysForEachStackObjectIds,
  stripUnlessPaysChoiceFromContext,
} from './oracleIRExecutorUnlessPaysForEachPermanents';
import { normalizeOracleManaCostString } from './oracleIRExecutorManaUtils';
import { applyCounterSpellStep } from './oracleIRExecutorMainLoopCounterSpellStep';
import {
  flushMainLoopFamilyMutableState,
  normalizeSkipMetadata,
  pickMainLoopFamilyCore,
  type MainLoopApplyHandledFn,
  type MainLoopApplyModifyPtFn,
  type MainLoopRecordSkippedFn,
  type MainLoopSetLastStepOutcomeFn,
  type MainLoopStepFamilyCtx,
} from './oracleIRExecutorMainLoopStepTypes';

export function tryApplyMainLoopLateSteps(
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
  const absorbExecutionReplayMutations = (
    execution: Parameters<typeof ctx.absorbExecutionReplayMutations>[0],
  ): void => {
    ctx.absorbExecutionReplayMutations(execution);
    // Nested apply mutates the parent loop list; keep the local copy in sync so
    // flushLets() does not wipe those mutations.
    replayMutations = ctx.replayMutations;
  };
  const mergeNestedExecutionOutcome = (
    nestedResult: Parameters<typeof ctx.mergeNestedExecutionOutcome>[0],
  ): void => {
    ctx.mergeNestedExecutionOutcome(nestedResult);
    // Merge writes lastActionOutcome onto ctx; flushLets() would otherwise
    // overwrite it with the stale local null and break follow-up "If you do".
    lastStepOutcome = ctx.lastStepOutcome;
    lastActionOutcome = ctx.lastActionOutcome;
  };

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
      case 'counter_spell': {
        const result = applyCounterSpellStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          currentCtx = { ...currentCtx, lastMovedCards };
        });
        break;
      }
      case 'exile': {
        const result = applyExileStep(nextState, step, currentCtx);
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
          currentCtx = {
            ...currentCtx,
            ...(lastMovedCards.length > 0 ? { lastMovedCards } : {}),
            ...(lastExiledCards.length > 0 ? { lastExiledCards } : {}),
          };
        });
        break;
      }
      case 'separate_into_piles': {
        const activePlayerIds = new Set(
          (nextState.players || [])
            .filter((player: any) => player?.inactive !== true)
            .map((player: any) => String(player?.id || '').trim())
            .filter(Boolean),
        );
        const turnOrderIds = (Array.isArray((nextState as any).turnOrder) && (nextState as any).turnOrder.length > 0
          ? (nextState as any).turnOrder
          : (nextState.players || []).map((player: any) => String(player?.id || '').trim()))
          .map((id: any) => String(id || '').trim())
          .filter((id: string) => id && activePlayerIds.has(id));
        const startId = String(controllerId || '').trim();
        const startIndex = Math.max(0, turnOrderIds.indexOf(startId));
        const playerOrder = turnOrderIds.length > 0
          ? [...turnOrderIds.slice(startIndex), ...turnOrderIds.slice(0, startIndex)]
          : [startId].filter(Boolean);

        recordSkippedStep(
          step,
          `Skipped pile separation (requires player assignments): ${step.raw}`,
          'player_choice_required',
          {
            classification: 'player_choice',
            metadata: {
              playerOrder,
              pileCount: Math.max(2, Number(step.pileCount) || 2),
              allowEmptyPiles: step.allowEmptyPiles === true,
              randomPileAction: step.randomPileAction || '',
              selector: String((step.what as any)?.text || (step.what as any)?.raw || ''),
            },
          },
        );
        break;
      }
      case 'library_chaos_exchange': {
        recordSkippedStep(
          step,
          `Skipped library chaos exchange (requires server zone/cast continuation): ${step.raw}`,
          step.targetMode === 'one_per_player'
            ? 'player_choice_required'
            : 'server_action_required',
          {
            classification: step.targetMode === 'one_per_player' ? 'player_choice' : 'unsupported',
            metadata: {
              targetMode: step.targetMode,
              targetText: String((step.target as any)?.text || (step.target as any)?.raw || ''),
              exileMode: step.exileMode,
              putLandOntoBattlefield: step.putLandOntoBattlefield === true,
              bottomRestRandom: step.bottomRestRandom === true,
            },
          },
        );
        break;
      }
      case 'repeated_zone_draft': {
        const result = applyRepeatedZoneDraftStep(nextState, step, currentCtx, lastExiledCards);
        if (result.kind === 'skipped') {
          recordSkippedStep(step, result.message, result.reason, result.options);
          break;
        }
        nextState = result.state;
        lastMovedBattlefieldPermanentIds = [...result.lastMovedBattlefieldPermanentIds];
        currentCtx = {
          ...currentCtx,
          lastMovedBattlefieldPermanentIds,
        };
        setLastStepOutcome(step, 'applied');
        log.push(...result.log);
        appliedSteps.push(step);
        break;
      }
      case 'sacrifice': {
        const result = applySacrificeStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastSacrificedCreaturesPowerTotal = Math.max(
            0,
            Number(appliedResult.lastSacrificedCreaturesPowerTotal) || 0
          );
          if (Array.isArray(appliedResult.lastSacrificedPermanents)) {
            lastSacrificedPermanents = [...appliedResult.lastSacrificedPermanents];
            currentCtx = {
              ...currentCtx,
              lastSacrificedPermanents,
            } as typeof currentCtx;
          }
        });
        break;
      }
      case 'schedule_delayed_battlefield_action': {
        const result = applyScheduleDelayedBattlefieldActionStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastCreatedTokenIds,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'choose_mode': {
        const result = applyChooseModeStep(nextState, step, currentCtx, options, recurse);
        if (result.kind === 'recorded_skip') {
          recordSkippedStep(step, result.message, result.reason, result.options);
          break;
        }

        nextState = result.state;
        log.push(...result.log);
        appliedSteps.push(...result.appliedSteps);
        skippedSteps.push(...result.skippedSteps);
        automationGaps.push(...result.automationGaps);
        pendingOptionalSteps.push(...result.pendingOptionalSteps);
        break;
      }
      case 'conditional': {
        const conditionEvaluation = evaluateConditionalWrapperCondition({
          condition: step.condition,
          nextState,
          controllerId,
          ctx: currentCtx,
          lastActionOutcome,
          lastStepOutcome,
          lastConditionalEvaluation,
          pendingSteps: step.steps,
          lastMovedCards,
          lastDiscardedCards,
          lastCreatedTokenIds,
          lastExcessDamageDealtThisWay,
          step,
        });

        if (conditionEvaluation === false) {
          lastConditionalEvaluation = false;
          if (step.elseSteps && step.elseSteps.length > 0) {
            const elseResult = recurse(nextState, step.elseSteps, currentCtx, options);
            nextState = elseResult.state;
            log.push(...elseResult.log);
            appliedSteps.push(...elseResult.appliedSteps);
            skippedSteps.push(...elseResult.skippedSteps);
            automationGaps.push(...elseResult.automationGaps);
            pendingOptionalSteps.push(...elseResult.pendingOptionalSteps);
            absorbExecutionReplayMutations(elseResult);
            mergeNestedExecutionOutcome(elseResult);
            if (elseResult.appliedSteps.length === 0) appliedSteps.push(step);
            else anyConditionalProducedSteps = true;
            break;
          }
          falseConditionalMarkers.add(step);
          if (appliedSteps.length === 0) appliedSteps.push(step);
          log.push(`Skipped conditional step (condition false): ${step.raw}`);
          break;
        }

        if (conditionEvaluation === null) {
          const normalizedConditionRaw = String(step.condition.raw || '')
            .replace(/\u2019/g, "'")
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
          const flatUnlessPayMatch = /^not \((?:you|that player|target player|target opponent|that opponent|an opponent|its controller) pay(?:s)? (?:\{[^}]+\}(?:\{[^}]+\})*|\d+ life)\)$/i.test(
            normalizedConditionRaw,
          );
          const scaledUnlessPayMatch = normalizedConditionRaw.match(
            /^not \((?:you|that player|target player|target opponent|that opponent|an opponent|its controller) pay(?:s)? (\{[^}]+\}(?:\{[^}]+\})*) for each (.+)\)$/i,
          );
          if (flatUnlessPayMatch || scaledUnlessPayMatch) {
            const conditionRaw = String(step.condition.raw || '').trim();
            const manaMatch = conditionRaw.match(/pay(?:s)? (\{[^}]+\}(?:\{[^}]+\})*)/i);
            const lifeMatch = conditionRaw.match(/pay(?:s)? (\d+) life/i);
            const scalerMatch = conditionRaw.match(/for each (.+?)\)?$/i);
            const nestedChoiceStep = step.steps.length === 1 ? step.steps[0] : step;
            recordSkippedStep(
              nestedChoiceStep,
              `Skipped ${nestedChoiceStep.kind} (requires player choice): ${nestedChoiceStep.raw}`,
              'player_choice_required',
              {
                classification: 'player_choice',
                metadata: {
                  unlessPayConditionRaw: step.condition.raw,
                  ...(manaMatch ? { unlessPayManaCost: normalizeOracleManaCostString(manaMatch[1]) } : {}),
                  ...(lifeMatch ? { unlessPayLifeAmount: Number(lifeMatch[1]) } : {}),
                  ...(scalerMatch ? { unlessPayScalerRaw: String(scalerMatch[1] || '').trim() } : {}),
                  unlessPayNestedStepKinds: step.steps.map(inner => inner.kind),
                },
              }
            );
            break;
          }

          lastConditionalEvaluation = null;
          recordSkippedStep(
            step,
            `Skipped conditional step (unsupported condition): ${step.raw}`,
            'unsupported_condition_clause',
            {
              metadata: {
                conditionKind: step.condition.kind,
                conditionRaw: step.condition.raw,
                nestedStepKinds: step.steps.map(inner => inner.kind),
              },
            }
          );
          break;
        }

        const resolvedAmount = resolveConditionalReferenceAmount({
          condition: step.condition,
          nextState,
          ctx: currentCtx,
        });
        const innerSteps = step.steps.map(inner => applyConditionalReferenceAmount(inner, resolvedAmount));
        const tokenIdsBeforeConditional = new Set(
          ((nextState.battlefield || []) as BattlefieldPermanent[])
            .filter((perm: any) => Boolean((perm as any)?.isToken))
            .map((perm: any) => String(perm?.id || '').trim())
            .filter(Boolean)
        );
        const result = recurse(
          nextState,
          innerSteps,
          {
            ...currentCtx,
            lastDiscardedCards,
            lastMovedCards,
            lastSacrificedPermanents,
            lastCreatedTokenIds,
            lastMovedBattlefieldPermanentIds,
            copyReplaySteps: steps.slice(0, stepIndex),
            lastTappedMatchingPermanentCount,
            ...(typeof resolvedAmount === 'number' && Number.isFinite(resolvedAmount)
              ? { referenceAmount: Math.max(0, resolvedAmount) }
              : {}),
          },
          options
        );
        nextState = result.state;
        const newTokenIds = ((nextState.battlefield || []) as BattlefieldPermanent[])
          .filter((perm: any) => Boolean((perm as any)?.isToken))
          .map((perm: any) => String(perm?.id || '').trim())
          .filter(id => id && !tokenIdsBeforeConditional.has(id));
        if (newTokenIds.length > 0) {
          lastCreatedTokenIds = newTokenIds;
          lastMovedBattlefieldPermanentIds = Array.from(
            new Set([...newTokenIds, ...lastMovedBattlefieldPermanentIds])
          );
          currentCtx = {
            ...currentCtx,
            lastMovedBattlefieldPermanentIds,
            selectorContext: {
              ...(currentCtx.selectorContext || {}),
              chosenObjectIds: Array.from(
                new Set([
                  ...((currentCtx.selectorContext?.chosenObjectIds || []) as readonly string[]).map(id =>
                    String(id || '').trim()
                  ).filter(Boolean),
                  ...newTokenIds,
                ])
              ),
            },
          };
        }
        lastConditionalEvaluation = true;
        log.push(...result.log);
        appliedSteps.push(...result.appliedSteps);
        skippedSteps.push(...result.skippedSteps);
        automationGaps.push(...result.automationGaps);
        pendingOptionalSteps.push(...result.pendingOptionalSteps);
        absorbExecutionReplayMutations(result);
        mergeNestedExecutionOutcome(result);
        if (result.appliedSteps.length === 0) appliedSteps.push(step);
        else anyConditionalProducedSteps = true;
        break;
      }
      case 'unless_pays_life': {
        const forEachIds = resolveUnlessPaysForEachPermanentIds(nextState, step, currentCtx);
        if (Array.isArray(forEachIds) && forEachIds.length === 0) {
          appliedSteps.push(step);
          break;
        }
        const lifeIterations = Array.isArray(forEachIds) ? forEachIds : [''];
        let lifeHalted = false;
        for (const permanentId of lifeIterations) {
          const boundCtx = permanentId
            ? bindUnlessPaysForEachContext(currentCtx, permanentId)
            : currentCtx;
          const result = evaluateUnlessPaysLifeStep(nextState, step, boundCtx);
          if (!('shouldApplyNestedSteps' in result)) {
            recordSkippedStep(step, result.message, result.reason, {
              ...result.options,
              metadata: normalizeSkipMetadata(result.options?.metadata),
            });
            lifeHalted = true;
            break;
          }

          if (result.state) {
            nextState = result.state;
          }
          log.push(...result.log);
          if (!result.shouldApplyNestedSteps) {
            continue;
          }

          const nestedResult = recurse(nextState, step.steps, boundCtx, options);
          nextState = nestedResult.state;
          log.push(...nestedResult.log);
          appliedSteps.push(...nestedResult.appliedSteps);
          skippedSteps.push(...nestedResult.skippedSteps);
          automationGaps.push(...nestedResult.automationGaps);
          pendingOptionalSteps.push(...nestedResult.pendingOptionalSteps);
          absorbExecutionReplayMutations(nestedResult);
          mergeNestedExecutionOutcome(nestedResult);
        }
        if (!lifeHalted) appliedSteps.push(step);
        break;
      }
      case 'unless_discards': {
        const result = evaluateUnlessDiscardsStep(nextState, step, currentCtx);
        if (!('shouldApplyNestedSteps' in result)) {
          recordSkippedStep(result.innerStep ?? step, result.message, result.reason, {
            ...result.options,
            metadata: normalizeSkipMetadata(result.options?.metadata),
          });
          break;
        }

        if (result.state) {
          nextState = result.state;
        }
        log.push(...result.log);
        if (!result.shouldApplyNestedSteps) {
          appliedSteps.push(step);
          break;
        }

        const unlessDiscardsNestedResult = recurse(nextState, step.steps, currentCtx, options);
        nextState = unlessDiscardsNestedResult.state;
        log.push(...unlessDiscardsNestedResult.log);
        appliedSteps.push(...unlessDiscardsNestedResult.appliedSteps);
        skippedSteps.push(...unlessDiscardsNestedResult.skippedSteps);
        automationGaps.push(...unlessDiscardsNestedResult.automationGaps);
        pendingOptionalSteps.push(...unlessDiscardsNestedResult.pendingOptionalSteps);
        absorbExecutionReplayMutations(unlessDiscardsNestedResult);
        mergeNestedExecutionOutcome(unlessDiscardsNestedResult);
        appliedSteps.push(step);
        break;
      }
      case 'grant_next_spell_cost_reduction': {
        const per = Boolean((step as any).perCountersRemoved);
        const countersRemoved = Number((currentCtx as any).countersRemovedThisWay ?? 0);
        const mana = String((step as any).mana || '{1}').trim();
        const genericFromMana = (mana.match(/\{(\d+)\}/) || [])[1];
        const perAmount = Number.parseInt(String(genericFromMana || '1'), 10);
        const amount = per
          ? Math.max(0, countersRemoved) * (Number.isFinite(perAmount) ? perAmount : 1)
          : Number((step as any).amount || perAmount || 0);
        (currentCtx as any).pendingNextSpellCostReduction = {
          genericAmount: amount,
          mana,
          sourceName: String(currentCtx.sourceName || ''),
        };
        appliedSteps.push(step);
        log.push(`Granted next-spell cost reduction of {${amount}} (countersRemoved=${countersRemoved})`);
        break;
      }
      case 'any_player_may': {
        const result = evaluateAnyPlayerMayStep(nextState, step as any, currentCtx, {
          allowOptional: options.allowOptional,
        });
        if (!('shouldApplyNestedSteps' in result)) {
          recordSkippedStep((result as any).innerStep ?? step, result.message, result.reason, {
            ...result.options,
            metadata: normalizeSkipMetadata(result.options?.metadata),
          });
          break;
        }

        if (result.state) {
          nextState = result.state;
        }
        log.push(...result.log);
        if (!result.shouldApplyNestedSteps) {
          appliedSteps.push(step);
          break;
        }

        const anyPlayerMayNestedResult = recurse(nextState, (step as any).steps || [], currentCtx, options);
        nextState = anyPlayerMayNestedResult.state;
        log.push(...anyPlayerMayNestedResult.log);
        appliedSteps.push(...anyPlayerMayNestedResult.appliedSteps);
        skippedSteps.push(...anyPlayerMayNestedResult.skippedSteps);
        automationGaps.push(...anyPlayerMayNestedResult.automationGaps);
        pendingOptionalSteps.push(...anyPlayerMayNestedResult.pendingOptionalSteps);
        absorbExecutionReplayMutations(anyPlayerMayNestedResult);
        mergeNestedExecutionOutcome(anyPlayerMayNestedResult);
        appliedSteps.push(step);
        break;
      }
      case 'unless_sacrifices': {
        const result = evaluateUnlessSacrificesStep(nextState, step, currentCtx);
        if (!('shouldApplyNestedSteps' in result)) {
          recordSkippedStep((result as any).innerStep ?? step, result.message, result.reason, {
            ...result.options,
            metadata: normalizeSkipMetadata(result.options?.metadata),
          });
          break;
        }

        if (result.state) {
          nextState = result.state;
        }
        log.push(...result.log);
        if (!result.shouldApplyNestedSteps) {
          appliedSteps.push(step);
          break;
        }

        const unlessSacrificesNestedResult = recurse(nextState, step.steps, currentCtx, options);
        nextState = unlessSacrificesNestedResult.state;
        log.push(...unlessSacrificesNestedResult.log);
        appliedSteps.push(...unlessSacrificesNestedResult.appliedSteps);
        skippedSteps.push(...unlessSacrificesNestedResult.skippedSteps);
        automationGaps.push(...unlessSacrificesNestedResult.automationGaps);
        pendingOptionalSteps.push(...unlessSacrificesNestedResult.pendingOptionalSteps);
        absorbExecutionReplayMutations(unlessSacrificesNestedResult);
        mergeNestedExecutionOutcome(unlessSacrificesNestedResult);
        appliedSteps.push(step);
        break;
      }
      case 'unless_pays_mana': {
        const stackIds = resolveUnlessPaysForEachStackObjectIds(nextState, step, currentCtx);
        const forEachIds = stackIds ?? resolveUnlessPaysForEachPermanentIds(nextState, step, currentCtx);
        if (Array.isArray(forEachIds) && forEachIds.length === 0) {
          appliedSteps.push(step);
          break;
        }
        const bindKind: 'stack' | 'permanent' | 'none' = Array.isArray(stackIds)
          ? 'stack'
          : Array.isArray(forEachIds)
            ? 'permanent'
            : 'none';
        let iterationIds = Array.isArray(forEachIds) ? [...forEachIds] : [''];
        const boundResumeId = bindKind === 'stack'
          ? String(currentCtx.targetSpellId || currentCtx.selectorContext?.targetSpellId || '').trim()
          : String(currentCtx.targetPermanentId || currentCtx.targetCreatureId || '').trim();
        const hasStampedChoice =
          currentCtx.unlessPaysManaChoice === 'pay'
          || currentCtx.unlessPaysManaChoice === 'decline'
          || currentCtx.selectorContext?.unlessPaysManaChoice === 'pay'
          || currentCtx.selectorContext?.unlessPaysManaChoice === 'decline';
        if (hasStampedChoice && boundResumeId && iterationIds.includes(boundResumeId)) {
          iterationIds = [boundResumeId, ...iterationIds.filter((id) => id !== boundResumeId)];
        }
        let manaHalted = false;
        let iterationCtx = currentCtx;
        let consumedStampedChoice = false;
        for (const iterationId of iterationIds) {
          const boundCtx = iterationId && bindKind === 'stack'
            ? bindUnlessPaysForEachStackContext(iterationCtx, iterationId)
            : iterationId && bindKind === 'permanent'
              ? bindUnlessPaysForEachContext(iterationCtx, iterationId)
              : iterationCtx;
          const result = evaluateUnlessPaysManaStep(nextState, step, boundCtx);
          if (!('shouldApplyNestedSteps' in result)) {
            recordSkippedStep(step, result.message, result.reason, {
              ...result.options,
              metadata: normalizeSkipMetadata(result.options?.metadata),
            });
            for (const nested of Array.isArray(step.steps) ? step.steps : []) {
              skippedSteps.push(nested);
            }
            manaHalted = true;
            break;
          }

          if (result.state) {
            nextState = result.state;
          }
          log.push(...result.log);
          const paidAmount = String((result as { paidManaAmount?: string }).paidManaAmount || '').trim();
          const paidCtx = paidAmount
            ? {
                ...boundCtx,
                unlessPaysManaChoice: 'pay' as const,
                unlessPaysManaAmount: paidAmount,
                selectorContext: {
                  ...(boundCtx.selectorContext || {}),
                  unlessPaysManaChoice: 'pay' as const,
                  unlessPaysManaAmount: paidAmount,
                },
              }
            : boundCtx;
          if (!result.shouldApplyNestedSteps) {
            const paidFollowups = Array.isArray((step as { paidSteps?: readonly OracleEffectStep[] }).paidSteps)
              ? (step as { paidSteps: readonly OracleEffectStep[] }).paidSteps
              : [];
            if (paidFollowups.length > 0) {
              const nestedPaid = recurse(nextState, paidFollowups, paidCtx, options);
              nextState = nestedPaid.state;
              log.push(...nestedPaid.log);
              appliedSteps.push(...nestedPaid.appliedSteps);
              skippedSteps.push(...nestedPaid.skippedSteps);
              automationGaps.push(...nestedPaid.automationGaps);
              pendingOptionalSteps.push(...nestedPaid.pendingOptionalSteps);
              absorbExecutionReplayMutations(nestedPaid);
              mergeNestedExecutionOutcome(nestedPaid);
            }
          } else {
            const nestedResult = recurse(nextState, step.steps, boundCtx, options);
            nextState = nestedResult.state;
            log.push(...nestedResult.log);
            appliedSteps.push(...nestedResult.appliedSteps);
            skippedSteps.push(...nestedResult.skippedSteps);
            automationGaps.push(...nestedResult.automationGaps);
            pendingOptionalSteps.push(...nestedResult.pendingOptionalSteps);
            absorbExecutionReplayMutations(nestedResult);
            mergeNestedExecutionOutcome(nestedResult);
          }
          if (hasStampedChoice && !consumedStampedChoice) {
            consumedStampedChoice = true;
            iterationCtx = stripUnlessPaysChoiceFromContext(iterationCtx);
          }
        }
        if (!manaHalted) appliedSteps.push(step);
        break;
      }
      case 'modify_damage': {
        setLastStepOutcome(step, 'applied');
        log.push(`Registered damage modification: ${step.raw}`);
        appliedSteps.push(step);
        break;
      }
      default: {
        if (String(step.kind) === 'grant_cast_permission') {
          setLastStepOutcome(step, 'applied');
          log.push(`Registered cast permission: ${String((step as { raw?: string }).raw || '')}`);
          appliedSteps.push(step);
          break;
        }
        if (step.kind === 'unknown') {
          const normalizedUnknown = String(step.raw || '')
            .replace(/\u2019/g, "'")
            .trim()
            .toLowerCase();
          if (/cast it for its madness cost or put it into your graveyard/.test(normalizedUnknown)) {
            setLastStepOutcome(step, 'applied');
            log.push(`Registered madness resolution: ${step.raw}`);
            appliedSteps.push(step);
            break;
          }
        }
        recordSkippedStep(step, `Skipped unsupported step: ${step.raw}`, 'unsupported_step');
        break;
      }
    }
  flushLets();
  return true;
}
