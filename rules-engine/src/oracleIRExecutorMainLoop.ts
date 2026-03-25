import type { GameState, PlayerID, BattlefieldPermanent, OracleAutomationGap } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import {
  appendOracleAutomationGapRecords,
  createOracleAutomationGapRecord,
} from './oracleIRAutomationGaps';
import {
  applyConditionalReferenceAmount,
  evaluateConditionalWrapperCondition,
  resolveConditionalReferenceAmount,
} from './oracleIRExecutorConditionalStepSupport';
import { prepareCopiedSpellExecutionContext } from './oracleIRExecutorCopySpellSupport';
import { applyAttachStep } from './oracleIRExecutorAttachStepHandlers';
import { applyChooseModeStep } from './oracleIRExecutorChooseModeStepHandlers';
import {
  applyDestroyStep,
  applyExileStep,
  applyGrantLeaveBattlefieldReplacementStep,
  applyGrantTemporaryDiesTriggerStep,
  applyRemoveCounterStep,
  applySacrificeStep,
  applyScheduleDelayedBattlefieldActionStep,
  applyScheduleDelayedTriggerStep,
  applyTapOrUntapStep,
} from './oracleIRExecutorBattlefieldStepHandlers';
import { applyDealDamageStep } from './oracleIRExecutorDamageStepHandlers';
import { applyExileTopStep, applyImpulseExileTopStep, applyModifyExilePermissionsStep } from './oracleIRExecutorExileStepHandlers';
import { applyGoadStep } from './oracleIRExecutorGoadStepHandlers';
import {
  applyProliferateStep,
  applyRingTemptsYouStep,
} from './oracleIRExecutorKeywordStepHandlers';
import type { LastKnownPermanentSnapshot } from './oracleIRExecutorLastKnownInfo';
import { evaluateModifyPtCondition } from './oracleIRExecutorModifyPtCondition';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import {
  applyModifyPtPerRevealedStep,
  applyModifyPtStep,
} from './oracleIRExecutorModifyPtStepHandlers';
import { applyMoveZoneStep } from './oracleIRExecutorMoveZoneStepHandlers';
import {
  applyAddManaStep,
  applyCreateEmblemStep,
  applyDiscardStep,
  applyDrawStep,
  applyGrantGraveyardPermissionStep,
  applyModifyGraveyardPermissionsStep,
  evaluateUnlessPaysLifeStep,
  applyGainLifeStep,
  applyLoseLifeStep,
  applyMillStep,
  applyPayManaStep,
  applyScryStep,
  applySurveilStep,
} from './oracleIRExecutorPlayerStepHandlers';
import { applyCreateTokenStep } from './oracleIRExecutorTokenStepHandlers';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionOptions,
  OracleIRExecutionResult,
} from './oracleIRExecutionTypes';

type RecurseExecutor = (
  state: GameState,
  steps: readonly OracleEffectStep[],
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions
) => OracleIRExecutionResult;

export function applyOracleIRStepsToGameStateImpl(
  state: GameState,
  steps: readonly OracleEffectStep[],
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions,
  recurse: RecurseExecutor
): OracleIRExecutionResult {
  type StepOutcomeKind = 'applied' | 'choice_required' | 'impossible' | 'unsupported';

  const log: string[] = [];
  const appliedSteps: OracleEffectStep[] = [];
  const skippedSteps: OracleEffectStep[] = [];
  const localAutomationGaps: OracleAutomationGap[] = [];
  const automationGaps: OracleAutomationGap[] = [];
  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  let currentCtx = ctx;
  let lastRevealedCardCount = 0;
  let lastDiscardedCardCount = 0;
  let lastExiledCardCount = 0;
  let lastExiledCards: any[] = Array.isArray(ctx.lastExiledCards) ? [...ctx.lastExiledCards] : [];
  let lastGrantedGraveyardCards: any[] = [];
  let lastMovedCards: any[] = [];
  let lastMovedBattlefieldPermanentIds: string[] = [];
  let lastGoadedCreatures: BattlefieldPermanent[] = [];
  let lastSacrificedCreaturesPowerTotal = 0;
  let lastSacrificedPermanents: LastKnownPermanentSnapshot[] = [];
  let lastExcessDamageDealtThisWay = 0;
  let lastScryLookedAtCount = 0;
  let lastStepOutcome: { readonly kind: StepOutcomeKind; readonly stepKind: OracleEffectStep['kind'] } | null = null;
  let lastActionOutcome: { readonly kind: StepOutcomeKind; readonly stepKind: OracleEffectStep['kind'] } | null = null;

  let nextState = state;
  const pendingOptionalSteps: OracleEffectStep[] = [];
  let automationGapSequence = 0;

  const setLastStepOutcome = (step: OracleEffectStep, kind: StepOutcomeKind): void => {
    lastStepOutcome = { kind, stepKind: step.kind };
    if (kind === 'applied' || kind === 'choice_required' || kind === 'impossible') {
      lastActionOutcome = { kind, stepKind: step.kind };
    }
  };

  const inferSkippedStepOutcome = (
    reasonCode: string,
    skipOptions: {
      readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
      readonly persist?: boolean;
    } | undefined
  ): StepOutcomeKind => {
    if (reasonCode === 'impossible_action' || skipOptions?.classification === 'invalid_input') return 'impossible';
    if (reasonCode === 'player_choice_required' || skipOptions?.classification === 'player_choice') return 'choice_required';
    return 'unsupported';
  };

  const recordSkippedStep = (
    step: OracleEffectStep,
    message: string,
    reasonCode: string,
    skipOptions: {
      readonly pending?: boolean;
      readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
      readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
      readonly persist?: boolean;
    } = {}
  ): void => {
    setLastStepOutcome(step, inferSkippedStepOutcome(reasonCode, skipOptions));
    skippedSteps.push(step);
    if (skipOptions.pending) {
      pendingOptionalSteps.push(step);
    }
    log.push(message);

    if (skipOptions.persist === false) {
      return;
    }

    const gap = createOracleAutomationGapRecord({
      state: nextState,
      ctx: currentCtx,
      step,
      reasonCode,
      message,
      sequence: ++automationGapSequence,
      classification: skipOptions.classification,
      metadata: skipOptions.metadata,
    });
    localAutomationGaps.push(gap);
    automationGaps.push(gap);
  };

  const applyHandledStepResult = (
    step: OracleEffectStep,
    result: any,
    onApplied?: (appliedResult: any) => void
  ): boolean => {
    if ('message' in result) {
      recordSkippedStep(step, result.message, result.reason, result.options);
      return false;
    }

    nextState = result.state;
    setLastStepOutcome(step, 'applied');
    onApplied?.(result);
    log.push(...result.log);
    appliedSteps.push(step);
    return true;
  };

  const applyModifyPtStepResult = (
    step: OracleEffectStep,
    result: any
  ): boolean => {
    if (result.kind === 'recorded_skip') {
      recordSkippedStep(step, result.message, result.reason);
      return false;
    }
    if (result.kind === 'unrecorded_skip') {
      setLastStepOutcome(step, 'unsupported');
      skippedSteps.push(step);
      log.push(result.log);
      return false;
    }
    if (result.kind !== 'applied') {
      return false;
    }

    nextState = result.state;
    setLastStepOutcome(step, 'applied');
    log.push(...result.log);
    appliedSteps.push(step);
    return true;
  };

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
    const step = steps[stepIndex];
    const isOptional = Boolean((step as any).optional);
    if (isOptional && !options.allowOptional) {
      recordSkippedStep(
        step,
        `Skipped optional step (needs player choice): ${(step as any).raw ?? step.kind}`,
        'optional_step_requires_player_choice',
        {
          pending: true,
          classification: 'player_choice',
        }
      );
      continue;
    }

    switch (step.kind) {
      case 'exile_top': {
        const result = applyExileTopStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExiledCardCount = Math.max(0, Number(appliedResult.lastExiledCardCount) || 0);
          lastExiledCards = [...appliedResult.lastExiledCards];
          currentCtx = { ...currentCtx, lastExiledCards };
        });
        break;
      }
      case 'impulse_exile_top': {
        const result = applyImpulseExileTopStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExiledCardCount = Math.max(0, Number(appliedResult.lastExiledCardCount) || 0);
          lastExiledCards = [...appliedResult.lastExiledCards];
          currentCtx = { ...currentCtx, lastExiledCards };
        });
        break;
      }
      case 'modify_exile_permissions': {
        const result = applyModifyExilePermissionsStep(nextState, step, { lastExiledCards });
        applyHandledStepResult(step, result);
        break;
      }
      case 'goad': {
        const result = applyGoadStep(nextState, step, currentCtx, controllerId);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastGoadedCreatures = [...appliedResult.lastGoadedCreatures];
        });
        break;
      }
      case 'draw': {
        const result = applyDrawStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'grant_graveyard_permission': {
        const result = applyGrantGraveyardPermissionStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastGrantedGraveyardCards = Array.isArray(appliedResult.lastGrantedGraveyardCards)
            ? [...appliedResult.lastGrantedGraveyardCards]
            : [];
        });
        break;
      }
      case 'modify_graveyard_permissions': {
        const result = applyModifyGraveyardPermissionsStep(nextState, step, {
          lastGrantedGraveyardCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'add_mana': {
        const result = applyAddManaStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'pay_mana': {
        const result = applyPayManaStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'choose_opponent': {
        const explicitOpponentId = (
          String(currentCtx.selectorContext?.targetOpponentId || '').trim() ||
          String(currentCtx.selectorContext?.targetPlayerId || '').trim()
        ) as PlayerID;
        const validExplicitOpponent = Boolean(
          explicitOpponentId &&
          (nextState.players || []).some(
            (p: any) => String(p?.id || '').trim() === explicitOpponentId && String(p?.id || '').trim() !== controllerId
          )
        );
        const opponentIds = (nextState.players || [])
          .map((p: any) => String(p?.id || '').trim())
          .filter((id: string) => Boolean(id) && id !== controllerId) as PlayerID[];
        const chosenOpponentId = (validExplicitOpponent
          ? explicitOpponentId
          : opponentIds.length === 1
            ? opponentIds[0]
            : '') as PlayerID | '';

        if (!chosenOpponentId) {
          recordSkippedStep(
            step,
            `Skipped choose opponent (requires player choice): ${step.raw}`,
            'player_choice_required',
            {
              classification: 'player_choice',
              metadata: {
                opponentCount: opponentIds.length,
              },
            }
          );
          break;
        }

        currentCtx = {
          ...currentCtx,
          selectorContext: {
            ...(currentCtx.selectorContext || {}),
            targetOpponentId: chosenOpponentId,
            targetPlayerId: chosenOpponentId,
          },
        };
        setLastStepOutcome(step, 'applied');
        log.push(`Chose opponent ${chosenOpponentId}`);
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
      case 'ring_tempts_you': {
        const result = applyRingTemptsYouStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'scry': {
        const result = applyScryStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastScryLookedAtCount = Math.max(0, Number(appliedResult.lastScryLookedAtCount) || 0);
        });
        break;
      }
      case 'surveil': {
        const result = applySurveilStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'mill': {
        const result = applyMillStep(nextState, step, currentCtx);
        if ('message' in result) {
          recordSkippedStep(step, result.message, result.reason, result.options);
          break;
        }

        nextState = result.state;
        if (typeof result.lastRevealedCardCount === 'number') {
          lastRevealedCardCount = Math.max(0, Number(result.lastRevealedCardCount) || 0);
        }
        log.push(...result.log);
        appliedSteps.push(step);
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
            lastExiledCardCount,
            lastExiledCards,
            lastMovedCards,
            lastGoadedCreatures,
            lastSacrificedCreaturesPowerTotal,
            lastSacrificedPermanents,
            lastExcessDamageDealtThisWay,
            lastScryLookedAtCount,
          },
          evaluateModifyPtWhereX,
          evaluateModifyPtCondition
        );
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
        });
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
            lastExiledCardCount,
            lastExiledCards,
            lastMovedCards,
            lastGoadedCreatures,
            lastSacrificedCreaturesPowerTotal,
            lastSacrificedPermanents,
            lastExcessDamageDealtThisWay,
            lastScryLookedAtCount,
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
            lastExiledCardCount,
            lastExiledCards,
            lastMovedCards,
            lastGoadedCreatures,
            lastSacrificedCreaturesPowerTotal,
            lastSacrificedPermanents,
            lastExcessDamageDealtThisWay,
            lastScryLookedAtCount,
          },
          evaluateModifyPtWhereX
        );
        applyHandledStepResult(step, result);
        break;
      }
      case 'deal_damage': {
        const result = applyDealDamageStep(nextState, step, currentCtx, {
          lastMovedCards,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExcessDamageDealtThisWay = Math.max(0, Number(appliedResult.excessDamageDealtThisWay) || 0);
        });
        break;
      }
      case 'tap_or_untap': {
        const result = applyTapOrUntapStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'remove_counter': {
        const result = applyRemoveCounterStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'move_zone': {
        const result = applyMoveZoneStep(nextState, step, currentCtx, {
          lastMovedCards,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards) ? [...appliedResult.lastMovedCards] : [];
          lastMovedBattlefieldPermanentIds = Array.isArray(appliedResult.lastMovedBattlefieldPermanentIds)
            ? [...appliedResult.lastMovedBattlefieldPermanentIds]
            : [];
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
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'grant_temporary_dies_trigger': {
        const result = applyGrantTemporaryDiesTriggerStep(nextState, step, currentCtx);
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
      case 'copy_spell': {
        const replaySourceSteps = Array.isArray(currentCtx.copyReplaySteps) ? currentCtx.copyReplaySteps : steps.slice(0, stepIndex);
        const replayableSteps = replaySourceSteps
          .filter((candidate): candidate is OracleEffectStep => candidate.kind !== 'copy_spell');
        if (replayableSteps.length === 0) {
          recordSkippedStep(
            step,
            `Skipped copy spell step (no replayable spell steps): ${step.raw}`,
            'invalid_copy_spell_source',
            {
              classification: 'invalid_input',
            }
          );
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

        const replayResult = recurse(nextState, replayableSteps, preparedCopy.ctx, options);
        nextState = replayResult.state;
        setLastStepOutcome(step, 'applied');
        log.push(...preparedCopy.log);
        log.push(...replayResult.log);
        appliedSteps.push(step);
        automationGaps.push(...replayResult.automationGaps);
        pendingOptionalSteps.push(...replayResult.pendingOptionalSteps);
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
        applyHandledStepResult(step, result);
        break;
      }
      case 'exile': {
        const result = applyExileStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'sacrifice': {
        const result = applySacrificeStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastSacrificedCreaturesPowerTotal = Math.max(
            0,
            Number(appliedResult.lastSacrificedCreaturesPowerTotal) || 0
          );
          lastSacrificedPermanents = Array.isArray(appliedResult.lastSacrificedPermanents)
            ? [...appliedResult.lastSacrificedPermanents]
            : [];
        });
        break;
      }
      case 'schedule_delayed_battlefield_action': {
        const result = applyScheduleDelayedBattlefieldActionStep(nextState, step, currentCtx);
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
          pendingSteps: step.steps,
          lastMovedCards,
        });

        if (conditionEvaluation === false) {
          skippedSteps.push(step);
          log.push(`Skipped conditional step (condition false): ${step.raw}`);
          break;
        }

        if (conditionEvaluation === null) {
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
        const result = recurse(
          nextState,
          innerSteps,
          {
            ...currentCtx,
            copyReplaySteps: steps.slice(0, stepIndex),
          },
          options
        );
        nextState = result.state;
        log.push(...result.log);
        appliedSteps.push(...result.appliedSteps);
        skippedSteps.push(...result.skippedSteps);
        automationGaps.push(...result.automationGaps);
        pendingOptionalSteps.push(...result.pendingOptionalSteps);
        break;
      }
      case 'unless_pays_life': {
        const result = evaluateUnlessPaysLifeStep(nextState, step, currentCtx);
        if (!('shouldApplyNestedSteps' in result)) {
          recordSkippedStep(step, result.message, result.reason, result.options);
          break;
        }

        log.push(...result.log);
        if (!result.shouldApplyNestedSteps) {
          skippedSteps.push(step);
          break;
        }

        const nestedResult = recurse(nextState, step.steps, currentCtx, options);
        nextState = nestedResult.state;
        log.push(...nestedResult.log);
        appliedSteps.push(...nestedResult.appliedSteps);
        skippedSteps.push(...nestedResult.skippedSteps);
        automationGaps.push(...nestedResult.automationGaps);
        pendingOptionalSteps.push(...nestedResult.pendingOptionalSteps);
        appliedSteps.push(step);
        break;
      }
      default:
        recordSkippedStep(step, `Skipped unsupported step: ${step.raw}`, 'unsupported_step');
        break;
    }
  }

  nextState = appendOracleAutomationGapRecords(nextState, localAutomationGaps);

  return { state: nextState, log, appliedSteps, skippedSteps, automationGaps, pendingOptionalSteps };
}
