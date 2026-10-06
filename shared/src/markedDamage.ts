/**
 * Marked damage on a permanent is mirrored across several legacy fields:
 * `damage` (spell effects / cleanup), `markedDamage` (combat), `damageMarked` (client badge, SBA),
 * and `counters.damage` (oracle IR executor). Cleanup writes 0 to all of them, but individual
 * writers only bump some, so a stale 0 in one field must never hide real damage in another.
 * Always read marked damage through this helper (the largest value wins).
 */
export function getMarkedDamage(perm: unknown): number {
  const p = perm as any;
  if (!p || typeof p !== 'object') return 0;
  let best = 0;
  for (const raw of [p.damage, p.markedDamage, p.damageMarked, p.counters?.damage]) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best;
}