// server/src/state/modules/turn-handlers/turnCombatDamageStatsPrevention.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: getCombatCreatureStats, prevention color/turn helpers,
// and applyCombatDamagePreventionEffects.
// Public entry symbols: getCombatCreatureStats, applyCombatDamagePreventionEffects.
// Leaf must not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { canDamageBePrevented } from "../game-state-effects.js";
import { calculateAllPTBonuses, calculateVariablePT, parsePT } from "../../utils.js";
import { debug } from "../../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function getCombatCreatureStats(ctx: GameContext, permanent: any): { power: number; toughness: number } {
  const card = permanent?.card || {};

  if (isFiniteNumber((permanent as any)?.effectivePower) && isFiniteNumber((permanent as any)?.effectiveToughness)) {
    return {
      power: Math.max(0, Number((permanent as any).effectivePower)),
      toughness: Number((permanent as any).effectiveToughness),
    };
  }

  let basePower = parsePT((permanent as any)?.basePower);
  let baseToughness = parsePT((permanent as any)?.baseToughness);

  if (!isFiniteNumber(basePower)) {
    basePower = parsePT(card?.power);
  }
  if (!isFiniteNumber(baseToughness)) {
    baseToughness = parsePT(card?.toughness);
  }

  if (!isFiniteNumber(basePower) || !isFiniteNumber(baseToughness)) {
    const variablePT = calculateVariablePT({ ...(card || {}), controller: (permanent as any)?.controller }, (ctx as any).state);
    if (variablePT) {
      basePower = isFiniteNumber(basePower) ? basePower : variablePT.power;
      baseToughness = isFiniteNumber(baseToughness) ? baseToughness : variablePT.toughness;
    }
  }

  const plusCounters = Number((permanent as any)?.counters?.['+1/+1'] || 0);
  const minusCounters = Number((permanent as any)?.counters?.['-1/-1'] || 0);
  const counterDelta = plusCounters - minusCounters;

  let otherCounterPower = 0;
  let otherCounterToughness = 0;
  if ((permanent as any)?.counters && typeof (permanent as any).counters === 'object') {
    for (const [counterType, amountRaw] of Object.entries((permanent as any).counters)) {
      if (counterType === '+1/+1' || counterType === '-1/-1') continue;
      const counterMatch = String(counterType).match(/^([+-]?\d+)\/([+-]?\d+)$/);
      if (!counterMatch) continue;
      const amount = Number(amountRaw || 0);
      otherCounterPower += parseInt(counterMatch[1], 10) * amount;
      otherCounterToughness += parseInt(counterMatch[2], 10) * amount;
    }
  }

  const allBonuses = calculateAllPTBonuses(permanent, (ctx as any).state);
  return {
    power: Math.max(0, Number(basePower || 0) + counterDelta + otherCounterPower + allBonuses.power),
    toughness: Number(baseToughness || 0) + counterDelta + otherCounterToughness + allBonuses.toughness,
  };
}

function getCurrentTurnNumberForEffects(state: any): number {
  const currentTurn = Number(state?.turnNumber ?? state?.turn ?? 0);
  return Number.isFinite(currentTurn) ? currentTurn : 0;
}

function getSourceColorsForPrevention(sourceCard: any): string[] {
  const rawColors = Array.isArray(sourceCard?.colors)
    ? sourceCard.colors
    : Array.isArray(sourceCard?.color_identity)
      ? sourceCard.color_identity
      : [];

  return rawColors
    .map((color: any) => String(color || '').trim().toUpperCase())
    .filter(Boolean);
}

export function applyCombatDamagePreventionEffects(
  ctx: GameContext,
  amount: number,
  sourceId: string,
  sourceCard: any,
  options?: { targetPlayerId?: string; targetPermanentId?: string },
): { prevented: number; remainingDamage: number } {
  const initialAmount = Math.max(0, Number(amount || 0));
  if (initialAmount <= 0) return { prevented: 0, remainingDamage: 0 };

  const state = (ctx as any).state as any;
  const effects = Array.isArray(state?.damagePreventionEffects) ? state.damagePreventionEffects : [];
  if (effects.length === 0) return { prevented: 0, remainingDamage: initialAmount };

  const targetRef = options?.targetPlayerId || options?.targetPermanentId || '';
  if (!canDamageBePrevented(ctx, sourceCard, targetRef)) {
    return { prevented: 0, remainingDamage: initialAmount };
  }

  const currentTurn = getCurrentTurnNumberForEffects(state);
  const normalizedSourceId = String(sourceId || '').trim();
  const targetPlayerId = String(options?.targetPlayerId || '').trim();
  const targetPermanentId = String(options?.targetPermanentId || '').trim();
  const sourceColors = getSourceColorsForPrevention(sourceCard);

  for (const effect of effects) {
    const targetSourceId = String(effect?.targetSourceId || '').trim();
    if (targetSourceId !== '*' && targetSourceId !== normalizedSourceId) continue;

    const effectTargetPlayerId = String(effect?.targetPlayerId || '').trim();
    if (effectTargetPlayerId && effectTargetPlayerId !== targetPlayerId) continue;

    const effectTargetPermanentId = String(effect?.targetPermanentId || '').trim();
    if (effectTargetPermanentId && effectTargetPermanentId !== targetPermanentId) continue;

    const expiresAtTurn = Number(effect?.expiresAtTurn);
    if (Number.isFinite(expiresAtTurn) && expiresAtTurn !== currentTurn) continue;

    const requiredColors = Array.isArray(effect?.colors)
      ? effect.colors.map((color: any) => String(color || '').trim().toUpperCase()).filter(Boolean)
      : [];
    if (requiredColors.length > 0 && !requiredColors.some((color: string) => sourceColors.includes(color))) continue;
    if (effect?.unblockedOnly === true) {
      const sourcePermanent = (Array.isArray(state?.battlefield) ? state.battlefield : []).find(
        (perm: any) => String(perm?.id || '').trim() === normalizedSourceId,
      );
      const attacking = sourcePermanent?.attacking;
      const blockedBy = sourcePermanent?.blockedBy;
      if (!attacking || (Array.isArray(blockedBy) && blockedBy.length > 0)) continue;
    }

    const capTo = Number(effect?.capTo);
    const hasCap = Number.isFinite(capTo);
    const remainingAmount = Number(effect?.remainingAmount);
    const hasFiniteShield = Number.isFinite(remainingAmount);
    const prevented = hasCap
      ? Math.max(0, initialAmount - Math.min(initialAmount, Math.max(0, capTo)))
      : hasFiniteShield ? Math.min(initialAmount, Math.max(0, remainingAmount)) : initialAmount;
    if (!hasCap && prevented <= 0) continue;

    if (effect?.consumeOnUse === true) {
      state.damagePreventionEffects = effects.filter((entry: any) => String(entry?.id || '') !== String(effect?.id || ''));
    } else if (hasFiniteShield) {
      const nextRemaining = Math.max(0, remainingAmount - prevented);
      state.damagePreventionEffects = effects.flatMap((entry: any) => {
        if (String(entry?.id || '') !== String(effect?.id || '')) return [entry];
        return nextRemaining > 0 ? [{ ...entry, remainingAmount: nextRemaining }] : [];
      });
    }

    debug(2, `${ts()} [dealCombatDamage] Prevented ${prevented} combat damage from ${normalizedSourceId || sourceCard?.name || 'source'}`);
    return { prevented, remainingDamage: Math.max(0, initialAmount - prevented) };
  }

  return { prevented: 0, remainingDamage: initialAmount };
}
