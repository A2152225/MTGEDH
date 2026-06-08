import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import { normalizeOracleText } from './oracleIRExecutorPlayerUtils';

const COUNT_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
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

function parseCountWord(raw: string): number | null {
  const normalized = normalizeOracleText(raw);
  if (!normalized) return null;
  if (normalized === 'x') return null;
  if (Object.prototype.hasOwnProperty.call(COUNT_WORDS, normalized)) {
    return COUNT_WORDS[normalized];
  }
  const numeric = Number.parseInt(normalized, 10);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
}

function evaluateCountExpression(
  state: GameState,
  controllerId: PlayerID,
  exprRaw: string,
  ctx: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime,
  targetPlayerId?: PlayerID
): number | null {
  const expr = normalizeOracleText(exprRaw);
  if (!expr) return null;

  const ctxForPlayer: OracleIRExecutionContext = targetPlayerId
    ? {
        ...ctx,
        selectorContext: {
          ...(ctx.selectorContext || {}),
          targetPlayerId,
        },
      }
    : ctx;

  const candidates = [
    expr.startsWith('x is ') ? expr : `x is ${expr}`,
    expr.startsWith('the number of ') ? `x is ${expr}` : `x is the number of ${expr}`,
  ];

  for (const candidate of candidates) {
    const evaluated = evaluateModifyPtWhereX(
      state,
      controllerId,
      candidate,
      undefined,
      ctxForPlayer,
      runtime
    );
    if (evaluated !== null) return Math.max(0, evaluated);
  }

  return null;
}

/**
 * Resolves "N for each …", "a card for each …", and related reference_amount scalers.
 */
export function tryResolveForEachReferenceAmount(
  state: GameState,
  controllerId: PlayerID,
  raw: string,
  ctx: OracleIRExecutionContext,
  options?: {
    readonly runtime?: ModifyPtRuntime;
    readonly targetPlayerId?: PlayerID;
  }
): number | null {
  const normalized = normalizeOracleText(String(raw || ''));
  if (!normalized) return null;

  if (normalized === 'that many' || normalized === 'that much') {
    const runtimeAmount = Number(options?.runtime?.lastReferenceAmount ?? ctx.referenceAmount);
    return Number.isFinite(runtimeAmount) ? Math.max(0, runtimeAmount) : null;
  }

  const cardForEach = normalized.match(/^(?:a\s+)?cards?\s+for\s+each\s+(.+)$/i);
  if (cardForEach) {
    return tryResolveForEachReferenceAmount(
      state,
      controllerId,
      `1 for each ${String(cardForEach[1] || '').trim()}`,
      ctx,
      options
    );
  }

  const forEachMatch = normalized.match(
    /^(?:(\d+)|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|x)\s+(?:cards?\s+)?for\s+each\s+(.+)$/i
  );
  if (forEachMatch) {
    const multiplierRaw = String(forEachMatch[1] || '').toLowerCase();
    const multiplier =
      multiplierRaw === 'x'
        ? (Number.isFinite(Number(ctx.xValue)) ? Math.max(0, Math.floor(Number(ctx.xValue))) : null)
        : parseCountWord(multiplierRaw);
    if (multiplier === null) return null;

    const eachPart = String(forEachMatch[2] || '').trim();
    const count = evaluateCountExpression(
      state,
      controllerId,
      eachPart,
      ctx,
      options?.runtime,
      options?.targetPlayerId
    );
    if (count === null) return null;
    return Math.max(0, multiplier * count);
  }

  if (normalized.startsWith('the number of ')) {
    return evaluateCountExpression(
      state,
      controllerId,
      normalized,
      ctx,
      options?.runtime,
      options?.targetPlayerId
    );
  }

  return null;
}
