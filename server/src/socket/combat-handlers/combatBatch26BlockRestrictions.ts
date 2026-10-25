// server/src/socket/combat-handlers/combatBatch26BlockRestrictions.ts
// Origin parent: combatLegalityGates.ts (canBlockAttacker).
// CR 509.1b reach-like block permission (the "can't be blocked as long as defending player
// controls X" restriction lives in shared/src/combatDefenderControlsUnblockable.ts via combatLandwalk):
//   "~ can block Dragons as though it had reach" (Dragon Hunter): the blocker may block a flying
//   attacker that has the named subtype.
// Public entry symbols: canBlockAsThoughReach.

const SELF = "(?:^|[\\n.]\\s*)(?:this creature|this permanent|it|~)\\s+";
const AS_THOUGH_REACH_RE = new RegExp(SELF + "can block ([a-z]+?)s? as though (?:it|this creature) had reach\\b", 'i');

function selfTexts(perm: any, extra: readonly string[] = []): string[] {
  const name = String(perm?.card?.name || perm?.name || '').trim().toLowerCase();
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);
  return [String(perm?.card?.oracle_text || ''), String(perm?.oracle_text || ''), ...extra]
    .map((t) => String(t || '').replace(/\u2019/g, "'").replace(/\([^)]*\)/g, ' ').toLowerCase())
    .map((t) => (name ? t.replace(new RegExp('\\b' + esc + '\\b', 'g'), '~') : t));
}

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

export function canBlockAsThoughReach(blocker: any, attacker: any): boolean {
  const attackerType = typeLineOf(attacker);
  for (const text of selfTexts(blocker)) {
    const m = text.match(AS_THOUGH_REACH_RE);
    if (m && m[1] && new RegExp('\\b' + m[1] + 's?\\b').test(attackerType)) return true;
  }
  return false;
}
