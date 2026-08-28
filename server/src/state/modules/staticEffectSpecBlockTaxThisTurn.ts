// Origin parent: server/src/state/modules/staticEffectSpecAttackYouTax.ts
// Cluster: this-turn lastingEffects blockTaxGeneric (War Cadence activation).
// Idle this-turn oracle stays 0 on collectBlockTax StaticEffectSpec.
// Public: collectThisTurnBlockTax

export interface ThisTurnBlockTax {
  cost: number;
  sources: string[];
}

export interface BlockTaxGenericStamp {
  type?: string;
  duration?: string;
  amount?: number;
  global?: boolean;
  source?: string;
}

/**
 * Per-blocker tax from lastingEffects.blockTaxGeneric stamps.
 * Global this-turn stamps apply to every unique blocking creature.
 */
export function collectThisTurnBlockTax(
  state: { lastingEffects?: readonly unknown[] } | null | undefined,
): ThisTurnBlockTax {
  const effects = Array.isArray(state?.lastingEffects) ? state.lastingEffects : [];
  const sources: string[] = [];
  let cost = 0;

  for (const entry of effects) {
    const stamp = entry as BlockTaxGenericStamp;
    if (String(stamp?.type || '') !== 'blockTaxGeneric') continue;
    const amount = Number(stamp.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    cost += amount;
    sources.push(String(stamp.source || 'an effect'));
  }

  return { cost, sources };
}
