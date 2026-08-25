import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getAmountOfManaSpent } from './oracleIRExecutorManaUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { evaluateExtendedConditionalClause } from './oracleIRExecutorConditionalStepSupportExtended';
import {
  type ConditionalCondition,
  type EvaluateConditionalWrapperConditionParams,
  resolveUnlessPayInnerCondition,
} from './oracleIRExecutorConditionalStepSupportHelpers.js';
import { tryEvaluateConditionalUnlessPayYouDoOtherwise } from './oracleIRExecutorConditionalStepUnlessPay.js';
import { tryEvaluateConditionalCreaturesDiedThisTurn } from './oracleIRExecutorConditionalStepCreaturesDied.js';
import { tryEvaluateConditionalKicked } from './oracleIRExecutorConditionalStepKicked.js';
import { tryEvaluateConditionalYouHaveGraveyard } from './oracleIRExecutorConditionalStepYouHaveGraveyard.js';
import { tryEvaluateWinIfCastSameNameThisGame } from './oracleIRExecutorWinIfCastSameNameThisGame.js';
import { tryEvaluateWinIfControlDifferentNames } from './oracleIRExecutorWinIfControlDifferentNames.js';

export function evaluateOracleStepUnlessCondition(
  unlessCondition: ConditionalCondition,
  state: GameState,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID = ctx.controllerId,
): boolean | null {
  return evaluateConditionalWrapperCondition({
    condition: unlessCondition,
    nextState: state,
    controllerId,
    ctx,
    lastActionOutcome: undefined,
    lastStepOutcome: undefined,
    lastConditionalEvaluation: undefined,
    pendingSteps: [],
    lastMovedCards: [],
    lastDiscardedCards: [],
    lastCreatedTokenIds: [],
    lastExcessDamageDealtThisWay: undefined,
  });
}

export function evaluateConditionalWrapperCondition(
  params: EvaluateConditionalWrapperConditionParams,
): boolean | null {
  const {
    condition,
    nextState,
    controllerId,
    ctx,
    lastActionOutcome,
    lastMovedCards,
    lastDiscardedCards,
    lastExcessDamageDealtThisWay,
  } = params;

  if (condition.kind === 'unless') {
    const inner = String(condition.raw || '')
      .replace(/\u2019/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const unlessResolved = resolveUnlessPayInnerCondition(inner, ctx, nextState, controllerId);
    if (unlessResolved !== undefined) return unlessResolved;
    {
      const extended = evaluateExtendedConditionalClause({
        normalizedRaw: inner,
        raw: condition.raw,
        nextState,
        controllerId,
        ctx,
        lastActionOutcome,
        lastMovedCards,
        lastDiscardedCards,
        lastExcessDamageDealtThisWay,
        step: params.step,
      });
      if (extended !== null) return extended;
    }
    return null;
  }

  if (condition.kind !== 'if' && condition.kind !== 'as_long_as') return null;

  const raw = String(condition.raw || '').trim().toLowerCase();
  let normalizedRaw = raw.replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
  if (normalizedRaw.startsWith('then ')) {
    normalizedRaw = normalizedRaw.replace(/^then\s+(?:if\s+)?/i, '').trim();
  }
  if (normalizedRaw.startsWith('if ')) {
    normalizedRaw = normalizedRaw.replace(/^if\s+/i, '').trim();
  }

  {
    const differentNames = tryEvaluateWinIfControlDifferentNames(params);
    if (differentNames !== undefined) return differentNames;
  }

  {
    const sameNameCast = tryEvaluateWinIfCastSameNameThisGame(params);
    if (sameNameCast !== undefined) return sameNameCast;
  }

  {
    const unlessPayYouDo = tryEvaluateConditionalUnlessPayYouDoOtherwise({
      ...params,
      evaluateRecursive: evaluateConditionalWrapperCondition,
    });
    if (unlessPayYouDo !== undefined) return unlessPayYouDo;
  }

  {
    const creaturesDied = tryEvaluateConditionalCreaturesDiedThisTurn({
      ...params,
      evaluateRecursive: evaluateConditionalWrapperCondition,
    });
    if (creaturesDied !== undefined) return creaturesDied;
  }

  {
    const kicked = tryEvaluateConditionalKicked({
      ...params,
      evaluateRecursive: evaluateConditionalWrapperCondition,
    });
    if (kicked !== undefined) return kicked;
  }

  {
    const youHaveGraveyard = tryEvaluateConditionalYouHaveGraveyard({
      ...params,
      evaluateRecursive: evaluateConditionalWrapperCondition,
    });
    if (youHaveGraveyard !== undefined) return youHaveGraveyard;
  }

  return null;
}

export function resolveConditionalReferenceAmount(params: {
  condition: ConditionalCondition;
  nextState: GameState;
  ctx: OracleIRExecutionContext;
}): number | null {
  const { condition, nextState, ctx } = params;
  if (condition.kind !== 'if' && condition.kind !== 'as_long_as') return null;

  const battlefield = getProcessedBattlefield(nextState);
  const sourceRef = getContextSourceObject(ctx, (idRaw: string) => findObjectByIdInState(nextState, battlefield, idRaw));
  if (!sourceRef) return null;

  const raw = String(condition.raw || '').trim().toLowerCase();
  if (
    raw === "the result is equal to this vehicle's mana value" ||
    raw === "the result is equal to this permanent's mana value"
  ) {
    const controllerId = String(ctx.controllerId || '').trim();
    const rolled = Number((nextState as any)?.lastDieRollByPlayer?.[controllerId]);
    return Number.isFinite(rolled) ? rolled : null;
  }

  const manaSpentMatch = raw.match(/^([a-z0-9]+)\s+or\s+more\s+mana\s+was\s+spent\s+to\s+cast\s+that\s+spell$/i);
  if (!manaSpentMatch) return null;

  return getAmountOfManaSpent(sourceRef);
}

export function applyConditionalReferenceAmount(step: OracleEffectStep, resolvedAmount: number | null): OracleEffectStep {
  if (resolvedAmount === null || !('amount' in (step as any))) return step;

  const amount = (step as any).amount;
  const raw = String(amount?.raw || '').trim().toLowerCase();
  if (amount?.kind !== 'unknown' || raw !== 'that much') return step;

  return {
    ...(step as any),
    amount: { kind: 'number', value: Math.max(0, resolvedAmount) },
  } as OracleEffectStep;
}
