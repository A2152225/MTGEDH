// server/src/socket/combat-handlers/combatBatch79TypeExceptByType.ts
// B79: Shifting Sliver — "Slivers can't be blocked except by Slivers."
// Team-wide type restriction from a permanent you control (not only the attacker's text).
// Public: getBatch79TypeExceptByTypeReason.

const TEAM_RE = /([a-z]+)s? can't be blocked except by \1s?\b/i;

function typeLine(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function hasCreatureType(perm: any, typeWord: string): boolean {
  const t = String(typeWord || '').toLowerCase().replace(/s$/, '');
  if (!t) return false;
  return new RegExp('\\b' + t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + 's?\\b').test(typeLine(perm));
}

/** Null when the block is legal under B79 type-except-by-type team statics. */
export function getBatch79TypeExceptByTypeReason(
  attacker: any,
  blocker: any,
  battlefield: readonly any[],
): string | null {
  const controller = String(attacker?.controller || '');
  if (!controller) return null;
  for (const perm of battlefield || []) {
    if (!perm || perm.phasedOut || String(perm.controller || '') !== controller) continue;
    const text = String(perm?.card?.oracle_text || '').toLowerCase().replace(/\u2019/g, "'");
    for (const line of text.split(/\n+/)) {
      const m = line.match(TEAM_RE);
      if (!m) continue;
      const typeWord = String(m[1] || '').toLowerCase();
      if (!hasCreatureType(attacker, typeWord)) continue;
      if (hasCreatureType(blocker, typeWord)) continue;
      return `Attacker can't be blocked except by ${typeWord}s`;
    }
  }
  return null;
}
