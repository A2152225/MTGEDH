/**
 * Minimum blockers (CR 702.111b menace; CR 509.1b "can't be blocked except by N or more creatures").
 * An attacker that is blocked at all must be blocked by at least its minimum.
 */
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function texts(permanent: any): string[] {
  const out: string[] = [];
  const push = (v: unknown) => { if (typeof v === 'string' && v.trim()) out.push(v.toLowerCase().replace(/\u2019/g, "'")); };
  push(permanent?.card?.oracle_text);
  push(permanent?.oracle_text);
  for (const key of ['grantedAbilities', 'temporaryAbilities', 'abilities']) {
    const list = permanent?.[key];
    if (Array.isArray(list)) for (const a of list) push(typeof a === 'string' ? a : a?.text ?? a?.ability);
  }
  return out;
}

export function getMinimumBlockers(attacker: any): number {
  let min = 1;
  const keywords: unknown[] = [
    ...(Array.isArray(attacker?.card?.keywords) ? attacker.card.keywords : []),
    ...(Array.isArray(attacker?.keywords) ? attacker.keywords : []),
  ];
  const all = texts(attacker);
  const hasMenace = keywords.some((k) => String(k || '').toLowerCase() === 'menace')
    || all.some((t) => t.split('\n').some((line) => line.replace(/\([^)]*\)/g, '').split(/,\s*/).map((p) => p.trim().replace(/\.$/, '')).includes('menace')));
  if (hasMenace) min = 2;
  for (const t of all) {
    for (const m of t.matchAll(/can't be blocked except by (\d+|[a-z]+) or more creatures/g)) {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORDS[m[1]];
      if (Number.isFinite(n) && n > min) min = n;
    }
  }
  return min;
}

/** First attacker blocked by fewer creatures than its minimum, or null. */
export function findMinimumBlockersViolation(
  battlefield: any[],
  assignments: Array<{ blockerId: string; attackerId: string }>,
): { attackerId: string; name: string; required: number; count: number } | null {
  const byAttacker = new Map<string, Set<string>>();
  for (const a of assignments) {
    const aid = String(a.attackerId || '').trim();
    const bid = String(a.blockerId || '').trim();
    if (!aid || !bid) continue;
    if (!byAttacker.has(aid)) byAttacker.set(aid, new Set());
    byAttacker.get(aid)!.add(bid);
  }
  for (const [aid, blockers] of byAttacker) {
    const perm = (battlefield || []).find((p: any) => String(p?.id) === aid);
    if (!perm) continue;
    const required = getMinimumBlockers(perm);
    if (blockers.size < required) {
      return { attackerId: aid, name: String(perm?.card?.name ?? perm?.name ?? aid), required, count: blockers.size };
    }
  }
  return null;
}
