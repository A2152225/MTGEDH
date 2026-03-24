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
import { applyChooseModeStep } from './oracleIRExecutorChooseModeStepHandlers';
import {
  applyDestroyStep,
  applyExileStep,
  applyRemoveCounterStep,
  applySacrificeStep,
  applyScheduleDelayedBattlefieldActionStep,
  applyTapOrUntapStep,
} from './oracleIRExecutorBattlefieldStepHandlers';
import { applyDealDamageStep } from './oracleIRExecutorDamageStepHandlers';
import { applyExileTopStep, applyImpulseExileTopStep } from './oracleIRExecutorExileStepHandlers';
import { applyGoadStep } from './oracleIRExecutorGoadStepHandlers';
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
  applyDiscardStep,
  applyDrawStep,
  applyGainLifeStep,
  applyLoseLifeStep,
  applyMillStep,
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
  let lastRevealedCardCount = 0;
  let lastDiscardedCardCount = 0;
  let lastExiledCardCount = 0;
  let lastExiledCards: any[] = [];
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
      ctx,
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

  for (const step of steps) {
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
        const result = applyExileTopStep(nextState, step, ctx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExiledCardCount = Math.max(0, Number(appliedResult.lastExiledCardCount) || 0);
          lastExiledCards = [...appliedResult.lastExiledCards];
        });
        break;
      }
      case 'impulse_exile_top': {
        const result = applyImpulseExileTopStep(nextState, step, ctx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExiledCardCount = Math.max(0, Number(appliedResult.lastExiledCardCount) || 0);
          lastExiledCards = [...appliedResult.lastExiledCards];
        });
        break;
      }
      case 'goad': {
        const result = applyGoadStep(nextState, step, ctx, controllerId);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastGoadedCreatures = [...appliedResult.lastGoadedCreatures];
        });
        break;
      }
      case 'draw': {
        const result = applyDrawStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'add_mana': {
        const result = applyAddManaStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'scry': {
        const result = applyScryStep(nextState, step, ctx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastScryLookedAtCount = Math.max(0, Number(appliedResult.lastScryLookedAtCount) || 0);
        });
        break;
      }
      case 'surveil': {
        const result = applySurveilStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'mill': {
        const result = applyMillStep(nextState, step, ctx);
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
          ctx,
          controllerId,
          {
            lastRevealedCardCount,
            lastDiscardedCardCount,
            lastExiledCardCount,
            lastExiledCards,
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
        const result = applyModifyPtPerRevealedStep(nextState, step, ctx, lastRevealedCardCount);
        applyModifyPtStepResult(step, result);
        break;
      }
      case 'discard': {
        const result = applyDiscardStep(nextState, step, ctx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastDiscardedCardCount = Math.max(0, Number(appliedResult.lastDiscardedCardCount) || 0);
        });
        break;
      }
      case 'gain_life': {
        const result = applyGainLifeStep(
          nextState,
          step,
          ctx,
          controllerId,
          {
            lastRevealedCardCount,
            lastDiscardedCardCount,
            lastExiledCardCount,
            lastExiledCards,
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
          ctx,
          controllerId,
          {
            lastRevealedCardCount,
            lastDiscardedCardCount,
            lastExiledCardCount,
            lastExiledCards,
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
        const result = applyDealDamageStep(nextState, step, ctx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExcessDamageDealtThisWay = Math.max(0, Number(appliedResult.excessDamageDealtThisWay) || 0);
        });
        break;
      }
      case 'tap_or_untap': {
        const result = applyTapOrUntapStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'remove_counter': {
        const result = applyRemoveCounterStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'move_zone': {
        const result = applyMoveZoneStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'create_token': {
        const result = applyCreateTokenStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'destroy': {
        const result = applyDestroyStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'exile': {
        const result = applyExileStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'sacrifice': {
        const result = applySacrificeStep(nextState, step, ctx);
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
        const result = applyScheduleDelayedBattlefieldActionStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'choose_mode': {
        const result = applyChooseModeStep(nextState, step, ctx, options, recurse);
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
          ctx,
          lastActionOutcome,
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
          ctx,
        });
        const innerSteps = step.steps.map(inner => applyConditionalReferenceAmount(inner, resolvedAmount));
        const result = recurse(nextState, innerSteps, ctx, options);
        nextState = result.state;
        log.push(...result.log);
        appliedSteps.push(...result.appliedSteps);
        skippedSteps.push(...result.skippedSteps);
        automationGaps.push(...result.automationGaps);
        pendingOptionalSteps.push(...result.pendingOptionalSteps);
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
