// server/src/state/modules/turn-handlers/turnCombatDamagePermanentApply.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: isCombatDamagePreventedForPermanent,
// modifyCombatDamageToPermanentAmount, applyCombatDamageToPlaneswalker.
// Public entry symbols: those three functions.
// Leaf must not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { calculateModifiedDamage } from "../game-state-effects.js";
import { applyShieldCounterDamagePrevention } from "../counter-common-effects.js";
import { evaluateDamageReplacementEvent } from "../replacement-effects.js";
import { applyCombatDamagePreventionEffects } from "./turnCombatDamageStatsPrevention.js";

export function isCombatDamagePreventedForPermanent(permanent: any): boolean {
  if (!permanent) {
    return false;
  }

  const abilityTexts = [
    ...(Array.isArray((permanent as any).tempAbilities) ? (permanent as any).tempAbilities : []),
    ...(Array.isArray((permanent as any).grantedAbilities) ? (permanent as any).grantedAbilities : []),
    ...(Array.isArray((permanent as any).temporaryAbilities) ? (permanent as any).temporaryAbilities : []),
  ]
    .map((entry: any) => {
      if (typeof entry === 'string') {
        return entry;
      }
      if (entry && typeof entry === 'object' && typeof entry.ability === 'string') {
        return entry.ability;
      }
      return '';
    })
    .map((entry: string) => entry.trim().toLowerCase())
    .filter(Boolean);

  return abilityTexts.some((entry) => /prevent all combat damage that would be dealt to (?:it|this creature) this turn/.test(entry));
}

/** Apply 616.1 amount modifiers (Furnace / Sound of Drums / Gisela / …) to combat damage to a permanent. */
export function modifyCombatDamageToPermanentAmount(
  ctx: GameContext,
  amount: number,
  sourcePermanent: any,
  targetPermanent: any,
): number {
  const { amount: modified } = calculateModifiedDamage(
    ctx,
    Math.max(0, Number(amount) || 0),
    String(sourcePermanent?.controller || ''),
    String(targetPermanent?.controller || ''),
    String(sourcePermanent?.id || ''),
    true,
    String(targetPermanent?.id || '') || undefined,
  );
  return modified;
}

export function applyCombatDamageToPlaneswalker(ctx: GameContext, permanent: any, amount: number, sourceCard: any, sourcePermanent: any): {
  prevented: boolean;
  appliedAmount: number;
  remainingLoyalty: number;
} {
  const sourceId = String(sourcePermanent?.id || '');
  const normalizedAmount = modifyCombatDamageToPermanentAmount(ctx, amount, sourcePermanent, permanent);
  const currentLoyalty = Number((permanent as any)?.counters?.loyalty ?? (permanent as any)?.loyalty ?? (permanent as any)?.card?.loyalty ?? 0) || 0;

  if (!permanent || normalizedAmount <= 0) {
    return { prevented: false, appliedAmount: 0, remainingLoyalty: currentLoyalty };
  }

  const prevention = applyCombatDamagePreventionEffects(ctx, normalizedAmount, sourceId, sourceCard, { targetPermanentId: String(permanent.id || '') });
  if (prevention.remainingDamage <= 0) {
    return { prevented: true, appliedAmount: 0, remainingLoyalty: currentLoyalty };
  }

  const shieldReplacement = evaluateDamageReplacementEvent({
    state: ctx.state,
    amount: prevention.remainingDamage,
    source: sourceCard,
    sourceId,
    target: permanent,
    targetId: String(permanent.id || ''),
  });
  if (isCombatDamagePreventedForPermanent(permanent) || (shieldReplacement.effectId === 'shield-counter-prevent-damage' && applyShieldCounterDamagePrevention(permanent))) {
    return { prevented: true, appliedAmount: 0, remainingLoyalty: currentLoyalty };
  }

  const nextLoyalty = currentLoyalty - prevention.remainingDamage;
  (permanent as any).counters = { ...((permanent as any).counters || {}), loyalty: nextLoyalty };
  (permanent as any).loyalty = nextLoyalty;

  return { prevented: false, appliedAmount: prevention.remainingDamage, remainingLoyalty: nextLoyalty };
}
