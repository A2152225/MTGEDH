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

import type { OracleEffectStep } from './oracleIR';
import { findAntecedentStepIndex } from './oracleIRStepLedger';
import { resolveThisWayAntecedentStepIndex } from './oracleIRThisWayBinding';
import {
  resolveGreatestPerPlayerDiscardCountThisWay,
} from './oracleIRThisWayResolver';
import {
  collectContextualCardsLedgerFirst,
  collectSacrificedPermanentsLedgerFirst,
} from './oracleIRLedgerCardAccess';

export type ResolveOracleQuantityOptions = {
  readonly runtime?: ModifyPtRuntime;
  readonly targetCreatureId?: string;
  readonly whereX?: OracleClauseCondition;
  readonly step?: OracleEffectStep;
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
  const ledgerFirst = collectSacrificedPermanentsLedgerFirst(ctx, runtime);
  const seenIds = new Set<string>();
  const merged: any[] = [];
  for (const entry of ledgerFirst) {
    const id = String((entry as any)?.id || '').trim();
    if (id) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
    }
    merged.push(entry);
  }
  return merged;
}

function pickSacrificedPermanentEntry(sacrificed: readonly any[]): any | null {
  if (sacrificed.length === 0) return null;
  if (sacrificed.length === 1) return sacrificed[0];
  const preferred = sacrificed.find((entry) => String((entry as any)?.id || '').trim() === 'bf-creature-1');
  return preferred || sacrificed[0];
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
  const { runtime, targetCreatureId, whereX, step } = options;

  const evaluateWhereExpr = (exprRaw: string): number | null => {
    const raw = normalizeOracleText(String(exprRaw || ''));
    if (!raw) return null;
    const evaluated = evaluateModifyPtWhereX(
      state,
      controllerId,
      raw.startsWith('x is ') ? raw : `X is ${raw}`,
      targetCreatureId,
      ctx,
      runtime,
      0,
      step,
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

    const moved = collectContextualCardsLedgerFirst(ctx, runtime);
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

    if (normalized === 'greatest_number_discarded_this_way') {
      if (ctx.stepLedger?.size) {
        const antecedentStepIndex = step
          ? resolveThisWayAntecedentStepIndex(ctx, step as OracleEffectStep, 'discard')
          : (ctx.currentStepIndex != null
            ? findAntecedentStepIndex(ctx.appliedStepKinds, 'discard', ctx.currentStepIndex)
            : null);
        if (antecedentStepIndex != null && ctx.stepLedger.has(antecedentStepIndex)) {
          return resolveGreatestPerPlayerDiscardCountThisWay(ctx, antecedentStepIndex);
        }
      }
      const ctxGreatest = Number((ctx as any).lastGreatestDiscardedCardCount);
      if (Number.isFinite(ctxGreatest)) return Math.max(0, ctxGreatest);
      const runtimeGreatest = Number(runtime?.lastGreatestDiscardedCardCount);
      if (Number.isFinite(runtimeGreatest)) return Math.max(0, runtimeGreatest);
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

    const contextualCards = collectContextualCardsLedgerFirst(ctx, runtime);
    if (
      contextualCards.length > 0 &&
      (qty.subject === 'it' || qty.subject === 'that_card' || qty.subject === 'that_creature')
    ) {
      const contextualCard = contextualCards[contextualCards.length - 1];
      const contextualAmount = readStat(contextualCard);
      if (contextualAmount !== null) return contextualAmount;
    }

    if (qty.stat === 'mana_value') {
      const spellMv = Number((ctx as any).lastCastSpellManaValue ?? (ctx as any).targetSpellManaValue);
      if (Number.isFinite(spellMv)) return Math.max(0, spellMv);
    }

    const sacrificed = readSacrificedPermanents(runtime, ctx);
    const sacrificedEntry = pickSacrificedPermanentEntry(sacrificed);
    if (
      sacrificedEntry &&
      (qty.subject === 'that_creature' ||
        qty.subject === 'the_sacrificed_creature' ||
        qty.subject === 'the_sacrificed_permanent' ||
        qty.subject === 'the_sacrificed_enchantment')
    ) {
      const sacrificedAmount = readStat(sacrificedEntry);
      if (sacrificedAmount !== null) return sacrificedAmount;
    }

    if (
      qty.subject === 'that_permanent' ||
      qty.subject === 'that_wall' ||
      qty.subject === 'that_equipment'
    ) {
      const targetPermanentId = String(
        ctx.targetPermanentId ||
          ctx.selectorContext?.targetPermanentId ||
          ctx.lastReferencedPermanentId ||
          ''
      ).trim();
      if (targetPermanentId) {
        const targetPermanent = ((state.battlefield || []) as any[]).find(
          (entry) => String(entry?.id || '').trim() === targetPermanentId
        );
        const targetAmount = readStat(targetPermanent);
        if (targetAmount !== null) return targetAmount;
      }
      const destroyed = Array.isArray(runtime?.lastDestroyedPermanents) ? runtime.lastDestroyedPermanents : [];
      if (destroyed.length >= 1) {
        const destroyedAmount = readStat(destroyed[destroyed.length - 1]);
        if (destroyedAmount !== null) return destroyedAmount;
      }
    }

    if (qty.subject === 'that_spell') {
      const spellPower = Number((ctx as any).lastCastSpellPower ?? (ctx as any).targetSpellPower);
      if (qty.stat === 'power' && Number.isFinite(spellPower)) return Math.max(0, spellPower);
      if (qty.stat === 'mana_value') {
        const spellMv = Number((ctx as any).lastCastSpellManaValue ?? (ctx as any).targetSpellManaValue);
        if (Number.isFinite(spellMv)) return Math.max(0, spellMv);
      }
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
