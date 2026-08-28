// Origin parent: server/src/state/modules/staticEffectSpecAttackYouTaxPhyrexian.ts
// Cluster: parse `{W/P}` attack-you tax tokens (no StaticEffectSpec collect).
// Public: parseAttackYouTaxPhyrexianGrant, AttackYouTaxPhyrexianGrant
// Leaf must not import staticEffectSpec.ts or the collector.

export type AttackYouTaxPhyrexianColor = 'white' | 'blue' | 'black' | 'red' | 'green';
export type AttackYouTaxPhyrexianSymbol = 'W' | 'U' | 'B' | 'R' | 'G';

export interface AttackYouTaxPhyrexianGrant {
  color: AttackYouTaxPhyrexianColor;
  symbol: AttackYouTaxPhyrexianSymbol;
  life: number;
}

const LETTER_TO_PHYREXIAN: Record<string, AttackYouTaxPhyrexianGrant> = {
  W: { color: 'white', symbol: 'W', life: 2 },
  U: { color: 'blue', symbol: 'U', life: 2 },
  B: { color: 'black', symbol: 'B', life: 2 },
  R: { color: 'red', symbol: 'R', life: 2 },
  G: { color: 'green', symbol: 'G', life: 2 },
};

export function parseAttackYouTaxPhyrexianGrant(costToken: string): AttackYouTaxPhyrexianGrant | null {
  const token = String(costToken || '').trim();
  const match = token.match(/^([WUBRG])\/P$/i);
  if (!match) return null;
  const mapped = LETTER_TO_PHYREXIAN[String(match[1] || '').toUpperCase()];
  return mapped ? { ...mapped } : null;
}
