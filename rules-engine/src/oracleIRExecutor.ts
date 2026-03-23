import type { GameState, PlayerID, BattlefieldPermanent, OracleAutomationGap } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionEventHint,
  OracleIRExecutionOptions,
  OracleIRExecutionResult,
} from './oracleIRExecutionTypes';
import {
  appendOracleAutomationGapRecords,
  createOracleAutomationGapRecord,
} from './oracleIRAutomationGaps';
import { applyChooseModeStep } from './oracleIRExecutorChooseModeStepHandlers';
import {
  applyDestroyStep,
  applyExileStep,
  applySacrificeStep,
  applyTapOrUntapStep,
} from './oracleIRExecutorBattlefieldStepHandlers';
import { applyDealDamageStep } from './oracleIRExecutorDamageStepHandlers';
import { applyExileTopStep, applyImpulseExileTopStep } from './oracleIRExecutorExileStepHandlers';
import { applyGoadStep } from './oracleIRExecutorGoadStepHandlers';
import { evaluateModifyPtCondition } from './oracleIRExecutorModifyPtCondition';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import {
  applyModifyPtPerRevealedStep,
  applyModifyPtStep,
} from './oracleIRExecutorModifyPtStepHandlers';
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
import { applyMoveZoneStep } from './oracleIRExecutorMoveZoneStepHandlers';
import { applyCreateTokenStep } from './oracleIRExecutorTokenStepHandlers';

export type {
  OracleIRExecutionContext,
  OracleIRExecutionEventHint,
  OracleIRExecutionOptions,
  OracleIRExecutionResult,
  OracleIRSelectorContext,
} from './oracleIRExecutionTypes';
export { buildOracleIRExecutionContext } from './oracleIRExecutorExecutionContext';

/**
 * Best-effort executor for Oracle Effect IR.
 *
 * Purposefully conservative:
 * - Only applies steps that can be executed without player choices.
 * - Skips optional ("You may") steps unless allowOptional=true.
 * - Skips targeting-dependent steps for now.
 */
export function applyOracleIRStepsToGameState(
  state: GameState,
  steps: readonly OracleEffectStep[],
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions = {}
): OracleIRExecutionResult {
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
  let lastExcessDamageDealtThisWay = 0;
  let lastScryLookedAtCount = 0;

  let nextState = state;
  const pendingOptionalSteps: OracleEffectStep[] = [];
  let automationGapSequence = 0;

  const recordSkippedStep = (
    step: OracleEffectStep,
    message: string,
    reasonCode: string,
    options: {
      readonly pending?: boolean;
      readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
      readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
      readonly persist?: boolean;
    } = {}
  ): void => {
    skippedSteps.push(step);
    if (options.pending) {
      pendingOptionalSteps.push(step);
    }
    log.push(message);

    if (options.persist === false) {
      return;
    }

    const gap = createOracleAutomationGapRecord({
      state: nextState,
      ctx,
      step,
      reasonCode,
      message,
      sequence: ++automationGapSequence,
      classification: options.classification,
      metadata: options.metadata,
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
      skippedSteps.push(step);
      log.push(result.log);
      return false;
    }
    if (result.kind !== 'applied') {
      return false;
    }

    nextState = result.state;
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
        const result = applyGainLifeStep(nextState, step, ctx);
        applyHandledStepResult(step, result);
        break;
      }

      case 'lose_life': {
        const result = applyLoseLifeStep(nextState, step, ctx);
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
        });
        break;
      }

      case 'choose_mode':
        {
          const result = applyChooseModeStep(nextState, step, ctx, options, applyOracleIRStepsToGameState);
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
        }
        break;

      default:
        recordSkippedStep(step, `Skipped unsupported step: ${step.raw}`, 'unsupported_step');
        break;
    }
  }

  nextState = appendOracleAutomationGapRecords(nextState, localAutomationGaps);

  return { state: nextState, log, appliedSteps, skippedSteps, automationGaps, pendingOptionalSteps };
}







