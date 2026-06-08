import type { GameState, PlayerID } from '../../shared/src';
import type { OracleClauseCondition, OracleQuantity } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import {
  getCardManaValue,
  normalizeOracleText,
  quantityToNumber,
  resolveUnknownMillUntilAmountForPlayer,
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

function readFiniteStat(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readObjectStat(
  entry: any,
  stat: 'power' | 'toughness' | 'mana_value'
): number | null {
  if (stat === 'mana_value') return getCardManaValue(entry);
  return stat === 'power'
    ? readFiniteStat(entry?.effectivePower ?? entry?.power ?? entry?.basePower ?? entry?.card?.power)
    : readFiniteStat(entry?.effectiveToughness ?? entry?.toughness ?? entry?.baseToughness ?? entry?.card?.toughness);
}

function readSacrificedPermanents(
  runtime: ModifyPtRuntime | undefined,
  ctx: OracleIRExecutionContext
): readonly any[] {
  if (Array.isArray(runtime?.lastSacrificedPermanents) && runtime.lastSacrificedPermanents.length > 0) {
    return runtime.lastSacrificedPermanents;
  }
  if (Array.isArray((ctx as any).lastSacrificedPermanents) && (ctx as any).lastSacrificedPermanents.length > 0) {
    return (ctx as any).lastSacrificedPermanents;
  }
  return [];
}

function resolveTargetCreatureYouControl(
  state: GameState,
  controllerId: PlayerID,
  ctx: OracleIRExecutionContext
): any | null {
  const targetId = String(
    ctx.selectorContext?.targetCreatureId ||
      ctx.targetCreatureId ||
      ctx.selectorContext?.targetPermanentId ||
      ctx.targetPermanentId ||
      ''
  ).trim();
  if (!targetId) return null;

  const permanent = ((state.battlefield || []) as any[]).find(
    (entry) => String(entry?.id || '').trim() === targetId
  );
  if (!permanent) return null;
  if (String(permanent?.controller || permanent?.controllerId || '').trim() !== String(controllerId || '').trim()) {
    return null;
  }
  return permanent;
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
    if (sourcePermanent) {
      const power = readPermanentPower(sourcePermanent);
      if (power !== null) return Math.max(0, power);
    }

    const sacrificed = readSacrificedPermanents(runtime, ctx);
    if (sacrificed.length === 1) {
      const power = readFiniteStat((sacrificed[0] as any)?.power);
      if (power !== null) return power;
    }

    const moved = [
      ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
      ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
    ];
    if (moved.length === 1) {
      const power = readFiniteStat((moved[0] as any)?.power ?? (moved[0] as any)?.card?.power);
      if (power !== null) return power;
    }

    return null;
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

    if (/^that spell(?:'|\u2019)?s mana value$/i.test(normalized)) {
      const spellMv = Number((ctx as any).lastCastSpellManaValue ?? (ctx as any).targetSpellManaValue);
      if (Number.isFinite(spellMv)) return Math.max(0, spellMv);
      const spellId = String(ctx.selectorContext?.targetSpellId || '').trim();
      if (spellId) {
        const stackSpell = ((state as any).stack || []).find(
          (entry: any) => String(entry?.id || '').trim() === spellId
        );
        const mv = getCardManaValue(stackSpell);
        if (mv !== null) return mv;
      }
    }

    if (/^cards equal to its power$/i.test(normalized)) {
      const sourcePermanent = getSourceBattlefieldPermanent(state, ctx);
      if (sourcePermanent) {
        const power = readPermanentPower(sourcePermanent);
        if (power !== null) return Math.max(0, power);
      }
    }

    if (/^equal to that card(?:'|\u2019)?s (?:mana value|power|toughness)$/i.test(normalized)) {
      return evaluateWhereExpr(normalized.replace(/^equal to /i, ''));
    }

    const evaluated = evaluateWhereExpr(normalized);
    if (evaluated !== null) return evaluated;

    const quantity = quantityToNumber(qty, ctx);
    return quantity === null ? null : Math.max(0, quantity);
  }

  if (qty.kind === 'object_stat') {
    const multiplier = Number.isFinite(Number((qty as any).multiplier)) ? Math.max(0, Number((qty as any).multiplier)) : 1;
    const readStat = (entry: any): number | null => {
      const value = readObjectStat(entry, qty.stat);
      return value === null ? null : Math.max(0, value * multiplier);
    };

    const contextualCards = [
      ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
      ...(Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : []),
      ...(Array.isArray(runtime?.lastDiscardedCards) ? runtime.lastDiscardedCards : []),
      ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
      ...(Array.isArray(ctx.lastExiledCards) ? ctx.lastExiledCards : []),
      ...(Array.isArray((ctx as any).lastDiscardedCards) ? (ctx as any).lastDiscardedCards : []),
    ];
    if (
      contextualCards.length > 0 &&
      (qty.subject === 'it' || qty.subject === 'that_card' || qty.subject === 'that_creature')
    ) {
      const contextualAmount = readStat(contextualCards[0]);
      if (contextualAmount !== null) return contextualAmount;
    }

    if (qty.stat === 'mana_value') {
      const spellMv = Number((ctx as any).lastCastSpellManaValue ?? (ctx as any).targetSpellManaValue);
      if (Number.isFinite(spellMv)) return Math.max(0, spellMv);
    }

    const sacrificed = readSacrificedPermanents(runtime, ctx);
    if (
      sacrificed.length === 1 &&
      (qty.subject === 'that_creature' ||
        qty.subject === 'the_sacrificed_creature' ||
        qty.subject === 'the_sacrificed_permanent')
    ) {
      const sacrificedAmount = readStat(sacrificed[0]);
      if (sacrificedAmount !== null) return sacrificedAmount;
    }

    if (qty.subject === 'this_creature' || qty.subject === 'this_permanent') {
      const sourcePermanent = getSourceBattlefieldPermanent(state, ctx);
      if (sourcePermanent) {
        const statAmount = readStat(sourcePermanent);
        if (statAmount !== null) return statAmount;
      }
    }

    if (qty.subject === 'target_creature_you_control') {
      const targetCreature = resolveTargetCreatureYouControl(state, controllerId, ctx);
      if (targetCreature) {
        const targetAmount = readStat(targetCreature);
        if (targetAmount !== null) return targetAmount;
      }
    }

    if (qty.subject === 'it' || qty.subject === 'that_creature' || qty.subject === 'source') {
      const sourcePermanent = getSourceBattlefieldPermanent(state, ctx);
      if (sourcePermanent) {
        const statAmount = readStat(sourcePermanent);
        if (statAmount !== null) return statAmount;
      }

      const triggeredId = String(
        ctx.targetCreatureId ||
          ctx.targetPermanentId ||
          ctx.selectorContext?.targetCreatureId ||
          ctx.selectorContext?.targetPermanentId ||
          ''
      ).trim();
      const sourceId = String(ctx.sourceId || '').trim();
      if (triggeredId && triggeredId !== sourceId) {
        const triggered = ((state.battlefield || []) as any[]).find(
          (entry) => String(entry?.id || '').trim() === triggeredId
        );
        if (triggered) {
          const triggeredAmount = readStat(triggered);
          if (triggeredAmount !== null) return triggeredAmount;
        }
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

  if (qty.kind === 'reveal_until_land') {
    const targetPlayerId = (ctx.selectorContext?.targetPlayerId ||
      ctx.selectorContext?.targetOpponentId) as PlayerID | undefined;
    if (targetPlayerId) {
      return resolveUnknownMillUntilAmountForPlayer(state, targetPlayerId, qty);
    }
    for (const player of state.players || []) {
      const playerId = String((player as any)?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      const resolved = resolveUnknownMillUntilAmountForPlayer(state, playerId, qty);
      if (resolved !== null) return resolved;
    }
    return null;
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
