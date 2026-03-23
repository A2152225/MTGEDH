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
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
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
import { getAmountOfManaSpent } from './oracleIRExecutorManaUtils';
import { applyGoadStep } from './oracleIRExecutorGoadStepHandlers';
import { evaluateModifyPtCondition } from './oracleIRExecutorModifyPtCondition';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { splitCardMatchesName } from './splitCards';
import {
  applyModifyPtPerRevealedStep,
  applyModifyPtStep,
} from './oracleIRExecutorModifyPtStepHandlers';
import type { LastKnownPermanentSnapshot } from './oracleIRExecutorLastKnownInfo';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
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
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';

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
    options: {
      readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
      readonly persist?: boolean;
    } | undefined
  ): StepOutcomeKind => {
    if (reasonCode === 'impossible_action' || options?.classification === 'invalid_input') return 'impossible';
    if (reasonCode === 'player_choice_required' || options?.classification === 'player_choice') return 'choice_required';
    return 'unsupported';
  };

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
    setLastStepOutcome(step, inferSkippedStepOutcome(reasonCode, options));
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

  const parseSmallNumberWord = (raw: string): number | null => {
    const text = String(raw || '').trim().toLowerCase();
    if (!text) return null;
    if (/^\d+$/.test(text)) return parseInt(text, 10);
    const lookup: Record<string, number> = {
      zero: 0,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      eleven: 11,
      twelve: 12,
    };
    return Number.isFinite(lookup[text]) ? lookup[text] : null;
  };

  const evaluateConditionalWrapperCondition = (
    condition: Extract<OracleEffectStep, { kind: 'conditional' }>['condition']
  ): boolean | null => {
    if (condition.kind !== 'if' && condition.kind !== 'as_long_as') return null;

    const generic = evaluateModifyPtCondition(nextState, controllerId, condition.raw);
    if (generic !== null) return generic;

    const battlefield = getProcessedBattlefield(nextState);
    const sourceRef = getContextSourceObject(ctx, (idRaw: string) => findObjectByIdInState(nextState, battlefield, idRaw));
    if (!sourceRef) return null;

    const raw = String(condition.raw || '').trim().toLowerCase();

    if (/^you (?:don't|do not)\b/i.test(raw)) {
      if (lastActionOutcome?.kind === 'impossible') return true;
      if (lastActionOutcome?.kind === 'applied') return false;
      return null;
    }

    if (raw === "you can't" || raw === 'you cannot') {
      if (lastActionOutcome?.kind === 'impossible') return true;
      if (lastActionOutcome?.kind === 'applied' || lastActionOutcome?.kind === 'choice_required') return false;
      return null;
    }

    if (raw === 'you win the flip') {
      return typeof ctx.wonCoinFlip === 'boolean' ? ctx.wonCoinFlip : null;
    }

    {
      const voteWinnerMatch = raw.match(/^([a-z0-9][a-z0-9' -]*) gets more votes$/i);
      if (voteWinnerMatch) {
        const expected = String(voteWinnerMatch[1] || '').trim().toLowerCase();
        const actual = String(ctx.winningVoteChoice || '').trim().toLowerCase();
        if (!expected || !actual) return null;
        return actual === expected;
      }
    }

    if (raw === 'that card has the chosen name') {
      const chosenName = String((sourceRef as any)?.chosenCardName || (sourceRef as any)?.card?.chosenCardName || '').trim();
      if (!chosenName) return null;
      const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === controllerId) as any;
      const topCard = Array.isArray(player?.library) && player.library.length > 0 ? player.library[0] : null;
      if (!topCard) return null;
      const normalizedChosenName = chosenName.toLowerCase();
      const topCardNames = new Set<string>();
      const pushName = (value: unknown) => {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized) topCardNames.add(normalized);
      };
      pushName((topCard as any)?.name);
      for (const face of Array.isArray((topCard as any)?.card_faces) ? (topCard as any).card_faces : []) {
        pushName((face as any)?.name);
      }
      if (topCardNames.has(normalizedChosenName)) return true;

      const leftName = String((topCard as any)?.leftHalf?.name || '').trim();
      const rightName = String((topCard as any)?.rightHalf?.name || '').trim();
      if (leftName && rightName) {
        try {
          return splitCardMatchesName(
            {
              type: 'split-card',
              leftHalf: {
                name: leftName,
                manaCost: '',
                types: [],
                subtypes: [],
                supertypes: [],
                text: '',
                power: null,
                toughness: null,
                loyalty: null,
                colors: [],
              },
              rightHalf: {
                name: rightName,
                manaCost: '',
                types: [],
                subtypes: [],
                supertypes: [],
                text: '',
                power: null,
                toughness: null,
                loyalty: null,
                colors: [],
              },
              hasSharedTypeLine: false,
            },
            chosenName
          );
        } catch {
          return null;
        }
      }
      return false;
    }

    if (raw === 'all five types on this permanent have counters over them') {
      const counters = ((sourceRef as any)?.counters || (sourceRef as any)?.card?.counters || {}) as Record<string, unknown>;
      const requiredKeys = ['artifact', 'creature', 'enchantment', 'instant', 'sorcery'];
      return requiredKeys.every(key => Number((counters as any)[key]) > 0);
    }

    if (
      raw === "the result is equal to this vehicle's mana value" ||
      raw === "the result is equal to this permanent's mana value"
    ) {
      const rolled = Number((nextState as any)?.lastDieRollByPlayer?.[controllerId]);
      if (!Number.isFinite(rolled)) return null;
      const manaValue = getCardManaValue((sourceRef as any)?.card || sourceRef);
      if (manaValue === null) return null;
      return rolled === manaValue;
    }

    const manaSpentMatch = raw.match(/^([a-z0-9]+)\s+or\s+more\s+mana\s+was\s+spent\s+to\s+cast\s+that\s+spell$/i);
    if (manaSpentMatch) {
      const threshold = parseSmallNumberWord(String(manaSpentMatch[1] || ''));
      if (threshold === null) return null;
      const spent = getAmountOfManaSpent(sourceRef);
      if (spent === null) return null;
      return spent >= threshold;
    }

    return null;
  };

  const resolveConditionalReferenceAmount = (
    condition: Extract<OracleEffectStep, { kind: 'conditional' }>['condition']
  ): number | null => {
    if (condition.kind !== 'if' && condition.kind !== 'as_long_as') return null;

    const battlefield = getProcessedBattlefield(nextState);
    const sourceRef = getContextSourceObject(ctx, (idRaw: string) => findObjectByIdInState(nextState, battlefield, idRaw));
    if (!sourceRef) return null;

    const raw = String(condition.raw || '').trim().toLowerCase();
    const manaSpentMatch = raw.match(/^([a-z0-9]+)\s+or\s+more\s+mana\s+was\s+spent\s+to\s+cast\s+that\s+spell$/i);
    if (!manaSpentMatch) return null;

    return getAmountOfManaSpent(sourceRef);
  };

  const applyConditionalReferenceAmount = (
    step: OracleEffectStep,
    resolvedAmount: number | null
  ): OracleEffectStep => {
    if (resolvedAmount === null || !('amount' in (step as any))) return step;

    const amount = (step as any).amount;
    const raw = String(amount?.raw || '').trim().toLowerCase();
    if (amount?.kind !== 'unknown' || raw !== 'that much') return step;

    return {
      ...(step as any),
      amount: { kind: 'number', value: Math.max(0, resolvedAmount) },
    } as OracleEffectStep;
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

      case 'conditional': {
        const conditionEvaluation = evaluateConditionalWrapperCondition(step.condition);

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

        const resolvedAmount = resolveConditionalReferenceAmount(step.condition);
        const innerSteps = step.steps.map(inner => applyConditionalReferenceAmount(inner, resolvedAmount));
        const result = applyOracleIRStepsToGameState(nextState, innerSteps, ctx, options);
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







