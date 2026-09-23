import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import { collectBattlefieldPermanentsForCountExpression } from './oracleIRExecutorModifyPtWhereMiscCounts';
import { normalizeOracleText } from './oracleIRExecutorPlayerUtils';
import { hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import { getSourceBattlefieldPermanent } from './oracleIRExecutorCreatureStepUtils';

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

function getPlayerHandCount(state: GameState, playerId: PlayerID): number {
  const zones = (state as any)?.zones;
  const zoneHandCount = zones?.[playerId]?.handCount;
  if (typeof zoneHandCount === 'number' && Number.isFinite(zoneHandCount) && zoneHandCount >= 0) {
    return zoneHandCount;
  }
  if (Array.isArray(zones?.[playerId]?.hand)) {
    return zones[playerId].hand.length;
  }

  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === String(playerId || '').trim()) as any;
  if (typeof player?.handCount === 'number' && Number.isFinite(player.handCount) && player.handCount >= 0) {
    return player.handCount;
  }

  return Array.isArray(player?.hand) ? player.hand.length : 0;
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
    if (Number.isFinite(runtimeAmount)) return Math.max(0, runtimeAmount);
    const source = getSourceBattlefieldPermanent(state, ctx);
    const squadTimesPaid = Number(
      (source as any)?.squadTimesPaid
      ?? (source as any)?.card?.squadTimesPaid
      ?? (ctx as any)?.sourceCard?.squadTimesPaid,
    );
    if (Number.isFinite(squadTimesPaid)) return Math.max(0, Math.floor(squadTimesPaid));
    return null;
  }

  const handSizePlayerId = String(options?.targetPlayerId || controllerId || '').trim() as PlayerID;

  {
    const lifeForEachAbove = normalized.match(
      /^(?:(\d+)|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:life\s+)?for\s+each\s+cards?\s+in\s+your\s+hand\s+above\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)$/i,
    );
    if (lifeForEachAbove) {
      const multiplier = parseCountWord(String(lifeForEachAbove[1] || '1').toLowerCase()) ?? 1;
      const threshold = parseCountWord(String(lifeForEachAbove[2] || '').toLowerCase());
      if (threshold === null) return null;
      const handSize = getPlayerHandCount(state, handSizePlayerId);
      return Math.max(0, multiplier * Math.max(0, handSize - threshold));
    }
  }

  if (/^(?:equal to )?the number of cards? in your hand$/i.test(normalized)) {
    return getPlayerHandCount(state, handSizePlayerId);
  }

  const perCardInYourHand = normalized.match(
    /^(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:life\s+)?for\s+each\s+card\s+in\s+your\s+hand$/i,
  );
  if (perCardInYourHand) {
    const multiplier = parseCountWord(String(perCardInYourHand[1] || '').toLowerCase());
    return multiplier === null ? null : multiplier * getPlayerHandCount(state, handSizePlayerId);
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
    if (/^(?:(?:\d+|a|an|one)\s+)?life you gained$/i.test(eachPart)) {
      const eventAmount = Number(options?.runtime?.lastReferenceAmount ?? ctx.referenceAmount);
      if (!Number.isFinite(eventAmount)) return null;
      return Math.max(0, multiplier * Math.floor(eventAmount));
    }
    if (/^auras? you controlled that (?:was|were) attached to it$/i.test(eachPart)) {
      if (Number.isFinite(Number(ctx.referenceAmount))) {
        return Math.max(0, multiplier * Math.max(0, Math.floor(Number(ctx.referenceAmount))));
      }
      const hostId = String(ctx.targetPermanentId || ctx.targetCreatureId || ctx.sourceId || '').trim();
      if (!hostId) return null;
      const counted = (state.battlefield || []).filter((perm: any) => {
        if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
        const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
        if (!typeLine.includes('aura')) return false;
        return String(perm?.attachedTo || '').trim() === hostId;
      }).length;
      return Math.max(0, multiplier * counted);
    }
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

function controlledBattlefieldPermanents(
  state: GameState,
  controllerId: PlayerID,
): readonly import('../../shared/src').BattlefieldPermanent[] {
  return ((state.battlefield || []) as import('../../shared/src').BattlefieldPermanent[]).filter(
    (perm: any) => String(perm?.controller || '').trim() === String(controllerId || '').trim(),
  );
}

/**
 * Battlefield permanent IDs referenced by a "for each …" / count antecedent in reference_amount text.
 * Used so follow-up steps like "Those creatures gain …" resolve to the counted set.
 */
export function collectForEachReferenceBattlefieldPermanentIds(
  state: GameState,
  controllerId: PlayerID,
  raw: string,
  ctx: OracleIRExecutionContext,
  options?: {
    readonly runtime?: ModifyPtRuntime;
    readonly targetPlayerId?: PlayerID;
  },
): readonly string[] {
  const normalized = normalizeOracleText(String(raw || ''));
  if (!normalized) return [];

  const cardForEach = normalized.match(/^(?:a\s+)?cards?\s+for\s+each\s+(.+)$/i);
  if (cardForEach) {
    return collectForEachReferenceBattlefieldPermanentIds(
      state,
      controllerId,
      `1 for each ${String(cardForEach[1] || '').trim()}`,
      ctx,
      options,
    );
  }

  const forEachMatch = normalized.match(
    /^(?:(\d+)|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|x)\s+(?:cards?\s+)?for\s+each\s+(.+)$/i,
  );
  const countExpr = forEachMatch
    ? String(forEachMatch[2] || '').trim()
    : normalized.startsWith('the number of ')
      ? normalized
      : '';

  if (!countExpr) return [];

  const controlled = controlledBattlefieldPermanents(state, controllerId);
  const ids = collectBattlefieldPermanentsForCountExpression({
    state,
    raw: countExpr.startsWith('the number of ') ? countExpr : `the number of ${countExpr}`,
    controlled,
    hasExecutorClass,
    normalizeOracleText,
  });
  if (ids.length > 0) return ids;

  return [];
}
