// Batch 16: "If you would roll one or more dice, instead roll that many dice plus one and ignore the lowest
// roll." (Wyll, Blade of Frontiers / Barbarian Class / Pixie Guide). Each instance adds one die and one
// ignored lowest roll.
// Public entry symbols: countDieRollAdvantage, applyDieRollAdvantage.

const ADVANTAGE_RE = /if you would roll one or more dice, instead roll that many dice plus one and ignore the lowest roll/i;

/** Number of extra dice (and ignored lowest rolls) `playerId` gets from permanents they control. */
export function countDieRollAdvantage(state: any, playerId: string): number {
  const pid = String(playerId || '').trim();
  if (!pid) return 0;
  const bf: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return bf.filter((p) => p && p.phasedOut !== true && String(p.controller || '') === pid
    && ADVANTAGE_RE.test(String(p.card?.oracle_text || p.oracle_text || '').replace(/\u2019/g, "'"))).length;
}

/** Rolls `advantage` extra dice with `rollOne` and drops the lowest `advantage` results. */
export function applyDieRollAdvantage(
  baseResults: readonly number[],
  advantage: number,
  rollOne: () => number,
): { kept: number[]; all: number[]; ignored: number[] } {
  const extra = Math.max(0, Math.trunc(Number(advantage) || 0));
  const all = [...baseResults];
  for (let i = 0; i < extra; i++) all.push(Number(rollOne()));
  if (extra === 0) return { kept: [...baseResults], all, ignored: [] };
  const order = all.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const drop = new Set(order.slice(0, extra).map((e) => e.i));
  return {
    kept: all.filter((_, i) => !drop.has(i)),
    all,
    ignored: order.slice(0, extra).map((e) => e.v),
  };
}