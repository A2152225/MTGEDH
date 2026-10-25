// server/src/socket/combat-handlers/combatBatch30BlockLimits.ts
// Batch 30: maximum-blocker statics (CR 509.1b):
//   "~ can't be blocked by more than one creature." (Charging Rhino, Stalking Tiger)
//   "Each creature you control can't be blocked by more than one creature." (Familiar Ground, Yuan Shao)
// Origin parent: combatDeclareBlockersRequest.ts (next to findMinimumBlockersViolation).
// Public entry symbols: getMaximumBlockers, findMaximumBlockersViolation, trimAssignmentsToMaximumBlockers (B31 AI path).

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const MAX_RE = /can't be blocked by more than (\d+|one|two|three|four|five) creatures?/;
const TEAM_RE = /(?:each creature|creatures) you control can't be blocked by more than (\d+|one|two|three|four|five) creatures?/;

function lines(perm: any): string[] {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '')
    .replace(/\u2019/g, "'").toLowerCase().split(/\n+/);
}

function toNum(word: string): number {
  return /^\d+$/.test(word) ? Number(word) : (WORDS[word] ?? Infinity);
}

/** Smallest blocker cap on the attacker (Infinity = no cap). */
export function getMaximumBlockers(attacker: any, battlefield: readonly any[]): number {
  let max = Infinity;
  for (const line of lines(attacker)) {
    if (TEAM_RE.test(line)) continue;
    const m = line.match(MAX_RE);
    if (m) max = Math.min(max, toNum(m[1]));
  }
  const controller = String(attacker?.controller || '');
  for (const perm of battlefield || []) {
    if (!perm || String(perm.controller || '') !== controller) continue;
    for (const line of lines(perm)) {
      const m = line.match(TEAM_RE);
      if (m) max = Math.min(max, toNum(m[1]));
    }
  }
  return max;
}

/** First attacker blocked by more creatures than allowed, or null. */
export function findMaximumBlockersViolation(
  battlefield: any[],
  assignments: Array<{ blockerId: string; attackerId: string }>,
): { attackerId: string; name: string; max: number; count: number } | null {
  const byAttacker = new Map<string, Set<string>>();
  for (const a of assignments || []) {
    const aid = String(a?.attackerId || '').trim();
    const bid = String(a?.blockerId || '').trim();
    if (!aid || !bid) continue;
    if (!byAttacker.has(aid)) byAttacker.set(aid, new Set());
    byAttacker.get(aid)!.add(bid);
  }
  for (const [aid, blockers] of byAttacker) {
    const perm = (battlefield || []).find((p: any) => String(p?.id) === aid);
    if (!perm) continue;
    const max = getMaximumBlockers(perm, battlefield);
    if (blockers.size > max) return { attackerId: aid, name: String(perm?.card?.name ?? aid), max, count: blockers.size };
  }
  return null;
}

/** AI path: drop blockers beyond each attacker's cap (keeps the first N assigned). */
export function trimAssignmentsToMaximumBlockers<T extends { blockerId: string; attackerId: string }>(
  battlefield: any[],
  assignments: T[],
): T[] {
  const kept: T[] = [];
  const perAttacker = new Map<string, Set<string>>();
  for (const a of assignments || []) {
    const aid = String(a?.attackerId || '').trim();
    const bid = String(a?.blockerId || '').trim();
    const perm = (battlefield || []).find((p: any) => String(p?.id) === aid);
    const max = perm ? getMaximumBlockers(perm, battlefield) : Infinity;
    const set = perAttacker.get(aid) || new Set<string>();
    if (!set.has(bid) && set.size >= max) continue;
    set.add(bid);
    perAttacker.set(aid, set);
    kept.push(a);
  }
  return kept;
}
