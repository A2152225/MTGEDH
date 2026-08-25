// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: resolveVariableAmount.
// Public entries: resolveVariableAmount.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { resolveSingleCreatureTargetId } from './oracleIRExecutorCreatureStepUtils';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import {
  getCardManaValue,
  normalizeOracleText,
  quantityToNumber,
} from './oracleIRExecutorPlayerUtils';
import { resolveControllerSpellCastCountThisTurn } from './oracleIRExecutorResolveQuantity';

export function resolveVariableAmount(
  state: GameState,
  controllerId: PlayerID,
  amount: Extract<OracleEffectStep, { kind: 'gain_life' | 'lose_life' }>['amount'],
  ctx: OracleIRExecutionContext,
  runtime: ModifyPtRuntime | undefined,
  evaluateWhereX?: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null
): number | null {
  const readFinite = (value: unknown): number | null => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const readObjectStat = (entry: any, stat: 'power' | 'toughness' | 'mana_value'): number | null => {
    if (stat === 'mana_value') {
      return getCardManaValue(entry);
    }

    return stat === 'power'
      ? readFinite(entry?.effectivePower ?? entry?.power ?? entry?.basePower ?? entry?.card?.power)
      : readFinite(entry?.effectiveToughness ?? entry?.toughness ?? entry?.baseToughness ?? entry?.card?.toughness);
  };

  const numericAmount = quantityToNumber(amount, ctx);
  if (numericAmount !== null) return numericAmount;
  if (amount.kind === 'x') {
    const xValue = Number(ctx?.xValue);
    return Number.isFinite(xValue) ? Math.max(0, Math.floor(xValue)) : null;
  }
  if (amount.kind === 'unknown') {
    const normalized = normalizeOracleText(String(amount.raw || ''));
    const spellsCastMatch = normalized.match(/^(?:(\d+)\s+(?:life\s+)?)?for each spells? (?:you(?:'ve| have)?|you) cast this turn$/i);
    if (spellsCastMatch) {
      const multiplier = Number(spellsCastMatch[1] || 1);
      const castCount = resolveControllerSpellCastCountThisTurn(state, controllerId, ctx.spellCastCountThisTurn);
      if (castCount !== null && Number.isFinite(multiplier)) return Math.max(0, castCount * Math.max(0, multiplier));
    }
  }
  if (amount.kind === 'reference_amount') {
    const normalized = normalizeOracleText(String(amount.raw || ''));
    const spellsCastMatch = normalized.match(/^(?:(\d+)\s+(?:life\s+)?)?for each spells? (?:you(?:'ve| have)?|you) cast this turn$|^the number of spells? (?:you(?:'ve| have)?|you) cast this turn$/i);
    if (spellsCastMatch) {
      const multiplier = Number(spellsCastMatch[1] || 1);
      const castCount = resolveControllerSpellCastCountThisTurn(state, controllerId, ctx.spellCastCountThisTurn);
      if (castCount !== null && Number.isFinite(multiplier)) return Math.max(0, castCount * Math.max(0, multiplier));
    }
    const runtimeAmount = Number(runtime?.lastReferenceAmount);
    if (Number.isFinite(runtimeAmount)) return Math.max(0, runtimeAmount);
    if (normalized === 'the high bid') {
      const referenceAmount = Number(ctx.referenceAmount);
      return Number.isFinite(referenceAmount) ? Math.max(0, referenceAmount) : 2;
    }
    if (/that card'?s mana value/i.test(normalized)) {
      const contextualCards = [
        ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
        ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
        ...(Array.isArray((ctx as any).lastRevealedCards) ? (ctx as any).lastRevealedCards : []),
        ...(Array.isArray(runtime?.lastDiscardedCards) ? runtime.lastDiscardedCards : []),
      ];
      if (contextualCards.length > 0) {
        const manaValue = getCardManaValue(contextualCards[contextualCards.length - 1]);
        if (manaValue !== null) return manaValue;
      }
    }
    if (/the sacrificed enchantment'?s mana value/i.test(normalized)) {
      const sacrificed = Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : [];
      if (sacrificed.length === 1) {
        const manaValue = getCardManaValue(sacrificed[0]);
        if (manaValue !== null) return manaValue;
      }
    }
    if (/the milled card'?s mana value/i.test(normalized)) {
      const milled = [
        ...(Array.isArray((ctx as any).lastMilledCards) ? (ctx as any).lastMilledCards : []),
        ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
        ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
      ];
      if (milled.length > 0) {
        const manaValue = getCardManaValue(milled[milled.length - 1]);
        if (manaValue !== null) return manaValue;
      }
    }
    if (evaluateWhereX) {
      const evaluated = evaluateWhereX(state, controllerId, `X is ${normalized}`, undefined, ctx, runtime);
      if (evaluated !== null) return Math.max(0, evaluated);
    }
    return null;
  }
  if (amount.kind === 'object_stat') {
    const sacrificed = Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : [];
    if (
      sacrificed.length >= 1 &&
      amount.subject === 'the_sacrificed_permanent'
    ) {
      const sacrificedAmount = readObjectStat(sacrificed[sacrificed.length - 1], amount.stat);
      if (sacrificedAmount !== null) return sacrificedAmount;
    }
    if (sacrificed.length === 1 && (amount.subject === 'that_creature' || amount.subject === 'the_sacrificed_creature')) {
      const sacrificedAmount = readObjectStat(sacrificed[0], amount.stat);
      if (sacrificedAmount !== null) return sacrificedAmount;
    }

    const moved = Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [];
    const exiled = Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : [];
    const contextualCards = [...moved, ...exiled, ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : [])];
    if (contextualCards.length >= 1 && (amount.subject === 'it' || amount.subject === 'that_card' || amount.subject === 'that_creature')) {
      for (let index = contextualCards.length - 1; index >= 0; index -= 1) {
        const contextualAmount = readObjectStat(contextualCards[index], amount.stat);
        if (contextualAmount !== null) return contextualAmount;
      }
    }
    if (moved.length === 1 && (amount.subject === 'it' || amount.subject === 'that_card' || amount.subject === 'that_creature')) {
      const movedAmount = readObjectStat(moved[0], amount.stat);
      if (movedAmount !== null) return movedAmount;
    }

    if (amount.subject === 'it' || amount.subject === 'that_creature') {
      const targetCreatureId = resolveSingleCreatureTargetId(
        state,
        { kind: 'raw', text: amount.subject === 'that_creature' ? 'that creature' : 'it' },
        ctx
      );
      if (targetCreatureId) {
        const targetCreature = (state.battlefield || []).find(
          (entry: any) => String(entry?.id || '').trim() === String(targetCreatureId || '').trim()
        );
        const targetAmount = readObjectStat(targetCreature, amount.stat);
        if (targetAmount !== null) return targetAmount;
      }
    }

    return null;
  }
  if (amount.kind !== 'unknown' || !evaluateWhereX) return null;

  const raw = String(amount.raw || '').trim().replace(/^equal to\s+/i, '').trim();
  if (!raw) return null;

  const evaluated = evaluateWhereX(state, controllerId, `X is ${raw}`, undefined, ctx, runtime);
  if (evaluated !== null) return evaluated;

  const sacrificed = Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : [];
  if (sacrificed.length === 1) {
    const snapshot = sacrificed[0] as any;
    const lowerRaw = raw.toLowerCase();
    if (/^(?:the sacrificed|that) creature's power$/.test(lowerRaw)) return readFinite(snapshot?.power);
    if (/^(?:the sacrificed|that) creature's toughness$/.test(lowerRaw)) return readFinite(snapshot?.toughness);
    if (/^(?:the sacrificed|that) creature's mana value$/.test(lowerRaw)) return readFinite(snapshot?.manaValue);
  }

  const moved = Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [];
  const contextualMoved = [
    ...moved,
    ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
    ...(Array.isArray((ctx as any).lastRevealedCards) ? (ctx as any).lastRevealedCards : []),
  ];
  if (contextualMoved.length >= 1) {
    const lowerRaw = raw.toLowerCase();
    const latest = contextualMoved[contextualMoved.length - 1];
    const manaValue = getCardManaValue(latest);
    if (manaValue !== null && /^(?:its|that card's|that creature's) mana value$/.test(lowerRaw)) {
      return manaValue;
    }
  }
  if (moved.length === 1) {
    const lowerRaw = raw.toLowerCase();
    const manaValue = getCardManaValue(moved[0]);
    if (manaValue !== null && /^(?:its|that card's|that creature's) mana value$/.test(lowerRaw)) {
      return manaValue;
    }
    if (/^(?:its|that card's|that creature's) power$/.test(lowerRaw)) {
      return readFinite((moved[0] as any)?.power ?? (moved[0] as any)?.card?.power);
    }
    if (/^(?:its|that card's|that creature's) toughness$/.test(lowerRaw)) {
      return readFinite((moved[0] as any)?.toughness ?? (moved[0] as any)?.card?.toughness);
    }
  }

  return null;
}
