import type { GameState, PlayerID } from '../../shared/src';
import type { OracleClauseCondition, OracleQuantity } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import {
  getCardManaValue,
  normalizeOracleText,
  quantityToNumber,
} from './oracleIRExecutorPlayerUtils';
import {
  getControlledPermanents,
  getSourceBattlefieldPermanent,
  permanentHasSubtype,
  permanentIsCreature,
  readPermanentPower,
} from './oracleIRExecutorCreatureStepUtils';
import { tryResolveForEachReferenceAmount } from './oracleIRExecutorForEachQuantity';

export type ResolveOracleQuantityOptions = {
  readonly runtime?: ModifyPtRuntime;
  readonly targetCreatureId?: string;
  readonly whereX?: OracleClauseCondition;
};

export function resolveOracleQuantityForPlayer(
  state: GameState,
  controllerId: PlayerID,
  qty: OracleQuantity,
  ctx: OracleIRExecutionContext,
  targetPlayerId: PlayerID,
  options: ResolveOracleQuantityOptions = {},
): number | null {
  const ctxForPlayer: OracleIRExecutionContext = {
    ...ctx,
    selectorContext: {
      ...(ctx.selectorContext || {}),
      targetPlayerId,
    },
  };
  return resolveOracleQuantity(state, controllerId, qty, ctxForPlayer, options);
}

function readObjectStat(
  entry: any,
  stat: 'power' | 'toughness' | 'mana_value'
): number | null {
  if (stat === 'mana_value') return getCardManaValue(entry);
  return stat === 'power'
    ? Number(entry?.effectivePower ?? entry?.power ?? entry?.basePower ?? entry?.card?.power)
    : Number(entry?.effectiveToughness ?? entry?.toughness ?? entry?.baseToughness ?? entry?.card?.toughness);
}

/**
 * Resolves spell/ability quantities from Oracle IR: cast {X}, reference amounts, and ", where X is …" clauses.
 */
export function resolveOracleQuantity(
  state: GameState,
  controllerId: PlayerID,
  qty: OracleQuantity,
  ctx: OracleIRExecutionContext,
  options: ResolveOracleQuantityOptions = {}
): number | null {
  const { runtime, targetCreatureId, whereX } = options;

  const evaluateWhereExpr = (exprRaw: string): number | null => {
    const raw = normalizeOracleText(String(exprRaw || ''));
    if (!raw) return null;
    const evaluated = evaluateModifyPtWhereX(
      state,
      controllerId,
      raw.startsWith('x is ') ? raw : `X is ${raw}`,
      targetCreatureId,
      ctx,
      runtime
    );
    return evaluated === null ? null : Math.max(0, evaluated);
  };

  if (whereX?.kind === 'where') {
    const fromWhere = evaluateWhereExpr(whereX.raw);
    if (fromWhere !== null) return fromWhere;
  }

  if (qty.kind === 'number') return Math.max(0, Math.floor(qty.value));

  if (qty.kind === 'x') {
    const xValue = Number(ctx.xValue);
    return Number.isFinite(xValue) ? Math.max(0, Math.floor(xValue)) : null;
  }

  if (qty.kind === 'source_power') {
    const sourcePermanent = getSourceBattlefieldPermanent(state, ctx);
    if (!sourcePermanent) return null;
    const power = readPermanentPower(sourcePermanent);
    return power === null ? null : Math.max(0, power);
  }

  if (qty.kind === 'reference_amount') {
    const normalized = normalizeOracleText(String(qty.raw || ''));
    const targetPlayerId = ctx.selectorContext?.targetPlayerId as PlayerID | undefined;
    const forEachAmount = tryResolveForEachReferenceAmount(state, controllerId, normalized, ctx, {
      runtime,
      targetPlayerId,
    });
    if (forEachAmount !== null) return forEachAmount;

    const spellsCastMatch = normalized.match(
      /^(?:(\d+)\s+)?for each spells? (?:you(?:'ve| have)?|you) cast this turn$|^(\d+)\s+for each spells? (?:you(?:'ve| have)?|you) cast this turn$|^the number of spells? (?:you(?:'ve| have)?|you) cast this turn$/i
    );
    if (spellsCastMatch) {
      const multiplier = Number(spellsCastMatch[1] || spellsCastMatch[2] || 1);
      const contextCount = Number(ctx.spellCastCountThisTurn);
      const stateCount = Number((state as any)?.spellsCastThisTurn?.[controllerId]);
      const castCount = Number.isFinite(contextCount)
        ? contextCount
        : Number.isFinite(stateCount)
          ? stateCount
          : null;
      if (castCount !== null && Number.isFinite(multiplier)) {
        return Math.max(0, castCount * Math.max(0, multiplier));
      }
    }

    const runtimeAmount = Number(runtime?.lastReferenceAmount);
    if (Number.isFinite(runtimeAmount)) return Math.max(0, runtimeAmount);

    if (normalized === 'twice that much' || normalized === 'twice x') {
      const ref = quantityToNumber({ kind: 'reference_amount', raw: 'that much' }, ctx);
      return ref === null ? null : Math.max(0, ref * 2);
    }

    if (normalized === 'x plus one') {
      const xValue = Number(ctx.xValue);
      return Number.isFinite(xValue) ? Math.max(0, Math.floor(xValue) + 1) : null;
    }

    const evaluated = evaluateWhereExpr(normalized);
    if (evaluated !== null) return evaluated;

    const quantity = quantityToNumber(qty, ctx);
    return quantity === null ? null : Math.max(0, quantity);
  }

  if (qty.kind === 'object_stat') {
    const sacrificed = Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : [];
    if (sacrificed.length === 1 && (qty.subject === 'that_creature' || qty.subject === 'the_sacrificed_creature')) {
      const sacrificedAmount = readObjectStat(sacrificed[0], qty.stat);
      if (sacrificedAmount !== null && Number.isFinite(sacrificedAmount)) {
        return Math.max(0, sacrificedAmount);
      }
    }

    if (qty.subject === 'it' || qty.subject === 'that_creature' || qty.subject === 'source') {
      const sourcePermanent = getSourceBattlefieldPermanent(state, ctx);
      if (sourcePermanent) {
        const statAmount = readObjectStat(sourcePermanent, qty.stat);
        if (statAmount !== null && Number.isFinite(statAmount)) return Math.max(0, statAmount);
      }
    }
    return null;
  }

  if (qty.kind === 'greatest_power_among_creatures_you_control') {
    const excludeSubtype = qty.excludeSubtype;
    const powers = getControlledPermanents(state, controllerId)
      .filter(permanentIsCreature)
      .filter((permanent) => !permanentHasSubtype(permanent, excludeSubtype))
      .map(readPermanentPower)
      .filter((value): value is number => value !== null);
    return powers.length > 0 ? Math.max(0, ...powers) : 0;
  }

  if (qty.kind === 'unknown') {
    const normalized = normalizeOracleText(String(qty.raw || ''));
    const xCards = normalized.match(/^x\s+cards?$/i);
    if (xCards) {
      const xValue = Number(ctx.xValue);
      if (Number.isFinite(xValue)) return Math.max(0, Math.floor(xValue));
      return evaluateWhereExpr(normalized.replace(/\s+cards?$/i, ''));
    }
    const evaluated = evaluateWhereExpr(normalized);
    if (evaluated !== null) return evaluated;
    return null;
  }

  const fallback = quantityToNumber(qty, ctx);
  return fallback === null ? null : Math.max(0, fallback);
}
