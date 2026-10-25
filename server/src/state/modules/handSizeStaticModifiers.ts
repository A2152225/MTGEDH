/**
 * Batch 23: static maximum hand size modifiers (CR 402.2).
 *  - "Your maximum hand size is N" (Null Profusion, Recycle, Necrodominance) sets the base.
 *  - "Your maximum hand size is increased/reduced by N" (Trusted Advisor, Thought Eater).
 *  - "Each opponent's maximum hand size is reduced by N" (Locust Miser, Jin-Gitaxias, Core Augur).
 * Public entry symbols: computeStaticMaxHandSize.
 */
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseCount(raw: string): number | null {
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  return raw in NUMBER_WORDS ? NUMBER_WORDS[raw] : null;
}

function rec(obj: unknown): Record<string, unknown> | null {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
}

function oracleOf(perm: unknown): string {
  const text = rec(rec(perm)?.card)?.oracle_text;
  return typeof text === 'string' ? text.toLowerCase().replace(/\u2019/g, "'") : '';
}

const SET_RE = /\byour maximum hand size is (\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b(?! less| more)/g;
const MOD_RE = /\b(your|each opponent's|each player's) maximum hand size is (increased|reduced) by (\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/g;

export function computeStaticMaxHandSize(battlefield: unknown, playerId: string, base = 7): number {
  if (!Array.isArray(battlefield)) return base;
  let size = base;
  let delta = 0;
  for (const perm of battlefield as unknown[]) {
    const r = rec(perm);
    if (!r || r.phasedOut === true) continue;
    const oracle = oracleOf(perm);
    if (!oracle.includes('maximum hand size')) continue;
    const mine = r.controller === playerId;
    if (mine) {
      for (const m of oracle.matchAll(SET_RE)) {
        const n = parseCount(m[1]);
        if (n !== null) size = n;
      }
    }
    for (const m of oracle.matchAll(MOD_RE)) {
      const applies = m[1] === "each player's" || (m[1] === 'your' ? mine : !mine);
      const n = parseCount(m[3]);
      if (!applies || n === null) continue;
      delta += m[2] === 'increased' ? n : -n;
    }
  }
  return Math.max(0, size + delta);
}
