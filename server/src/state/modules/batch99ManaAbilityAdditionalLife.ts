// server/src/state/modules/batch99ManaAbilityAdditionalLife.ts
// "Mana abilities of this land cost an additional N life to activate."
// Public: parseAdditionalLifeToActivateManaAbilities,
// withAdditionalManaAbilityLifeCost.

export type ManaAbilityLifeEffectLike = { amount: number; isDamage: boolean };

export function parseAdditionalLifeToActivateManaAbilities(oracle: string): number | null {
  const match = String(oracle || '').replace(/\u2019/g, "'").match(
    /mana abilities of this (?:land|permanent) cost an additional (\d+) life to activate/i,
  );
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function withAdditionalManaAbilityLifeCost(
  card: any,
  base: ManaAbilityLifeEffectLike,
): ManaAbilityLifeEffectLike {
  const extra = parseAdditionalLifeToActivateManaAbilities(String(card?.oracle_text || card?.oracleText || ''));
  if (!extra) return base;
  return { amount: Number(base.amount || 0) + extra, isDamage: base.isDamage === true };
}
