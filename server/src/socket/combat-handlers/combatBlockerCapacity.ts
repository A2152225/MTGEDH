/**
 * Per-blocker capacity (CR 509.1a / 509.1b): a creature blocks one attacker unless an
 * effect says it "can block an additional [N] creature(s)" or "can block any number of creatures".
 * Mirrors rules-engine getBlockerCapacity (server does not import rules-engine).
 */
const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function collectTexts(permanent: any): string {
  const parts: string[] = [];
  const push = (v: unknown) => { if (typeof v === 'string' && v.trim()) parts.push(v); };
  push(permanent?.card?.oracle_text);
  push(permanent?.oracle_text);
  for (const key of ['grantedAbilities', 'temporaryAbilities', 'abilities']) {
    const list = permanent?.[key];
    if (Array.isArray(list)) for (const a of list) push(typeof a === 'string' ? a : a?.text ?? a?.ability);
  }
  return parts.join('\n').toLowerCase().replace(/\u2019/g, "'");
}

export function getServerBlockerCapacity(permanent: any): number {
  const text = collectTexts(permanent);
  if (!text) return 1;
  if (/can block any number of creatures/.test(text)) return Number.POSITIVE_INFINITY;
  let extra = 0;
  for (const m of text.matchAll(/can block an additional(?: (\d+|[a-z]+))? creatures? (?:each combat|this turn)/g)) {
    const raw = m[1] || '1';
    extra += /^\d+$/.test(raw) ? Number(raw) : (WORDS[raw] ?? 1);
  }
  return 1 + extra;
}

/** Returns the first blocker assigned to more attackers than its capacity allows. */
export function findBlockerCapacityViolation(
  battlefield: any[],
  assignments: Array<{ blockerId: string; attackerId: string }>,
): { blockerId: string; name: string; capacity: number; count: number } | null {
  const byBlocker = new Map<string, Set<string>>();
  for (const a of assignments) {
    const bid = String(a.blockerId || '').trim();
    if (!bid) continue;
    if (!byBlocker.has(bid)) byBlocker.set(bid, new Set());
    byBlocker.get(bid)!.add(String(a.attackerId || '').trim());
  }
  for (const [bid, attackers] of byBlocker) {
    if (attackers.size <= 1) continue;
    const perm = (battlefield || []).find((p: any) => String(p?.id) === bid);
    if (!perm) continue;
    const capacity = getServerBlockerCapacity(perm);
    if (attackers.size > capacity) {
      return { blockerId: bid, name: String(perm?.card?.name ?? perm?.name ?? bid), capacity, count: attackers.size };
    }
  }
  return null;
}
