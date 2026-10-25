// server/src/socket/combat-handlers/combatBatch25BlockRestrictions.ts
// Origin parent: combatLegalityGates.ts (canBlockAttacker).
// Self evasion restrictions (CR 509.1b):
//   "~ can't be blocked except by creatures with flying" (Silhana Ledgewalker, Treetop Rangers)
//   "~ can't be blocked except by creatures with flying or reach" / "... and/or reach" (Signal Pest)
//   "~ can't be blocked as long as it's attacking alone" (Dream Prowler, Yuan-Ti Malison)
// Only the attacker's own text (or temporary self texts) counts: "creatures you control can't ..."
// lines are not self restrictions and are skipped by the self prefix.
// Public entry symbols: getBatch25BlockRestrictionReason, isAttackingAlone.

const SELF = "(?:^|[\\n.]\\s*)(?:this creature|this permanent|it|~)\\s+can(?:'t|not) be blocked ";
const EXCEPT_KEYWORD_RE = new RegExp(SELF + 'except by creatures with (flying|reach)(?:,?\\s+(?:and\\/or|or|and)\\s+(flying|reach))?\\b', 'i');
const ALONE_RE = new RegExp(SELF + "(?:as long as|while) (?:it's|it is) attacking alone\\b", 'i');

function normalize(raw: string): string {
  return String(raw || '').replace(/\u2019/g, "'").replace(/\([^)]*\)/g, ' ').toLowerCase();
}

function selfTexts(attacker: any, extra: readonly string[]): string[] {
  const name = String(attacker?.card?.name || attacker?.name || '').trim().toLowerCase();
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);
  return [String(attacker?.card?.oracle_text || ''), String(attacker?.oracle_text || ''), ...extra]
    .map(normalize)
    .map((t) => (name ? t.replace(new RegExp('\\b' + esc + '\\b', 'g'), '~') : t));
}

export function isAttackingAlone(attacker: any, battlefield: readonly any[]): boolean {
  const controller = String(attacker?.controller || '');
  const attackers = battlefield.filter((p: any) => p && String(p.controller || '') === controller && !!p.attacking);
  if (attackers.length === 0) return !!attacker?.attacking;
  return attackers.length === 1 && String(attackers[0]?.id) === String(attacker?.id);
}

export function getBatch25BlockRestrictionReason(
  attacker: any,
  blocker: any,
  battlefield: readonly any[],
  attackerTexts: readonly string[],
  blockerHas: (permanent: any, keyword: string) => boolean,
): string | null {
  const texts = selfTexts(attacker, attackerTexts);
  for (const text of texts) {
    const m = text.match(EXCEPT_KEYWORD_RE);
    if (m) {
      const allowed = [m[1], m[2]].filter(Boolean) as string[];
      if (!allowed.some((kw) => blockerHas(blocker, kw))) {
        return `Attacker can't be blocked except by creatures with ${allowed.join(' or ')}`;
      }
    }
    if (ALONE_RE.test(text) && isAttackingAlone(attacker, battlefield)) {
      return "Attacker can't be blocked while attacking alone";
    }
  }
  return null;
}
