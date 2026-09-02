// Origin parent: server/src/state/modules/staticEffectSpecAttackYouTax.ts
// Cluster: this-turn / until-your-next-turn lastingEffects attackTaxGeneric
//   (War Tax activation global; Forbidding Spirit attack-you). Idle this-turn
//   oracle stays 0 on collectAttackYouTaxForDefender.
// Public: collectThisTurnAttackTaxForAttacker

export interface ThisTurnAttackTaxForAttacker {
  cost: number;
  sources: string[];
}

export interface AttackTaxGenericStamp {
  type?: string;
  duration?: string;
  amount?: number;
  global?: boolean;
  defenderId?: string;
  source?: string;
}

/**
 * Per-attacker tax from lastingEffects.attackTaxGeneric stamps.
 * Global stamps apply to every attacking creature. Attack-you stamps apply
 * only when that creature attacks `defenderId` (player or a PW they control;
 * caller must pass resolveDefendingPlayerIdForAttackTarget).
 */
export function collectThisTurnAttackTaxForAttacker(
  state: { lastingEffects?: readonly unknown[] } | null | undefined,
  defenderId: string,
): ThisTurnAttackTaxForAttacker {
  return collectThisTurnAttackStamp(state, defenderId, 'attackTaxGeneric');
}

export function collectThisTurnAttackLifeTaxForAttacker(
  state: { lastingEffects?: readonly unknown[] } | null | undefined,
  defenderId: string,
): ThisTurnAttackTaxForAttacker {
  return collectThisTurnAttackStamp(state, defenderId, 'attackTaxLife');
}

function collectThisTurnAttackStamp(
  state: { lastingEffects?: readonly unknown[] } | null | undefined,
  defenderId: string,
  type: 'attackTaxGeneric' | 'attackTaxLife',
): ThisTurnAttackTaxForAttacker {
  const effects = Array.isArray(state?.lastingEffects) ? state.lastingEffects : [];
  const defender = String(defenderId || '').trim();
  const sources: string[] = [];
  let cost = 0;

  for (const entry of effects) {
    const stamp = entry as AttackTaxGenericStamp;
    if (String(stamp?.type || '') !== type) continue;
    const amount = Number(stamp.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const isGlobal = stamp.global === true;
    if (!isGlobal) {
      if (!defender || String(stamp.defenderId || '').trim() !== defender) continue;
    }

    cost += amount;
    sources.push(String(stamp.source || 'an effect'));
  }

  return { cost, sources };
}
