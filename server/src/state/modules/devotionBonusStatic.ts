// server/src/state/modules/devotionBonusStatic.ts
// B61 re-export: Altar of the Pantheon devotion increase lives in shared/devotionCount.
export {
  devotionIncreaseBonusAmongPermanents,
} from '../../../../shared/src/devotionCount.js';

const INCREASE_RE =
  /your devotion to each color and each combination of colors is increased by (one|two|three|four|five|\d+)/i;
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

export function oracleDevotionIncreaseAmount(oracle: string): number {
  const m = String(oracle || '').match(INCREASE_RE);
  if (!m) return 0;
  const raw = String(m[1] || '').toLowerCase();
  if (/^\d+$/.test(raw)) return Math.max(0, Math.floor(Number(raw)));
  return WORDS[raw] || 0;
}
