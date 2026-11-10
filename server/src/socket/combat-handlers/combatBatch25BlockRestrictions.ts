// server/src/socket/combat-handlers/combatBatch25BlockRestrictions.ts
// Origin parent: combatLegalityGates.ts (canBlockAttacker).
// Self evasion restrictions (CR 509.1b):
//   "~ can't be blocked except by creatures with flying" (Silhana Ledgewalker, Treetop Rangers)
//   "~ can't be blocked except by creatures with flying or reach" / "... and/or reach" (Signal Pest)
//   "~ can't be blocked as long as it's attacking alone" (Dream Prowler, Yuan-Ti Malison)
// Only the attacker's own text (or temporary self texts) counts: "creatures you control can't ..."
// lines are not self restrictions and are skipped by the self prefix.
// Public entry symbols: getBatch25BlockRestrictionReason, isAttackingAlone.

const SELF = "(?:^|[\\n.]\\s*)(?:(?:this creature|this permanent|it|~)\\s+)?can(?:'t|not) be blocked ";
const EXCEPT_KEYWORD_RE = new RegExp(SELF + 'except by creatures with (flying|reach)(?:,?\\s+(?:and\\/or|or|and)\\s+(flying|reach))?\\b', 'i');
// B78: Prowler's Helm — "can't be blocked except by Walls."
const EXCEPT_TYPE_RE = new RegExp(SELF + 'except by ([a-z]+)s?\\b', 'i');
const ALONE_RE = new RegExp(SELF + "(?:as long as|while) (?:it's|it is) attacking alone\\b", 'i');
// B77: Ayesha Tanaka — "can't be blocked as long as defending player controls N or more artifacts."
const DEFENDER_ARTIFACTS_RE = new RegExp(
  SELF + 'as long as defending player controls (\\d+|[a-z]+) or more artifacts\\b',
  'i',
);
const COUNT_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function normalize(raw: string): string {
  return String(raw || '').replace(/\u2019/g, "'").replace(/\([^)]*\)/g, ' ').toLowerCase();
}

function selfTexts(attacker: any, extra: readonly string[]): string[] {
  const name = String(attacker?.card?.name || attacker?.name || '').trim().toLowerCase();
  const short = name.split(',')[0].trim();
  const names = [name, short].filter((n, i, arr) => n.length >= 3 && arr.indexOf(n) === i);
  return [String(attacker?.card?.oracle_text || ''), String(attacker?.oracle_text || ''), ...extra]
    .map(normalize)
    .map((t) => {
      let out = t;
      for (const n of names) {
        const esc = n.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);
        out = out.replace(new RegExp('\\b' + esc + '\\b', 'g'), '~');
      }
      return out.replace(/\bthis (?:creature|permanent|vehicle|artifact)\b/g, '~');
    });
}

export function isAttackingAlone(attacker: any, battlefield: readonly any[]): boolean {
  const controller = String(attacker?.controller || '');
  const attackers = battlefield.filter((p: any) => p && String(p.controller || '') === controller && !!p.attacking);
  if (attackers.length === 0) return !!attacker?.attacking;
  return attackers.length === 1 && String(attackers[0]?.id) === String(attacker?.id);
}

function defendingPlayerArtifactCount(battlefield: readonly any[], defendingPlayerId: string | undefined): number {
  if (!defendingPlayerId) return 0;
  return battlefield.filter((p: any) => p && String(p.controller || '') === defendingPlayerId
    && /\bartifact\b/i.test(String(p.card?.type_line || ''))).length;
}

export function getBatch25BlockRestrictionReason(
  attacker: any,
  blocker: any,
  battlefield: readonly any[],
  attackerTexts: readonly string[],
  blockerHas: (permanent: any, keyword: string) => boolean,
  defendingPlayerId?: string,
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
    const exceptType = text.match(EXCEPT_TYPE_RE);
    if (exceptType) {
      const typeWord = String(exceptType[1] || '').replace(/ies$/, 'y').replace(/s$/, '');
      if (typeWord && !['creature', 'artifact', 'enchantment', 'land'].includes(typeWord)) {
        const tl = String(blocker?.card?.type_line || blocker?.type_line || '').toLowerCase();
        if (!new RegExp('\\b' + typeWord + '\\b').test(tl)) {
          return `Attacker can't be blocked except by ${typeWord}s`;
        }
      }
    }
    if (ALONE_RE.test(text) && isAttackingAlone(attacker, battlefield)) {
      return "Attacker can't be blocked while attacking alone";
    }
    const defArts = text.match(DEFENDER_ARTIFACTS_RE);
    if (defArts) {
      const raw = String(defArts[1] || '');
      const need = /^\d+$/.test(raw) ? Number(raw) : COUNT_WORDS[raw];
      if (Number.isFinite(need) && defendingPlayerArtifactCount(battlefield, defendingPlayerId) >= Number(need)) {
        return "Attacker can't be blocked (defending player controls enough artifacts)";
      }
    }
  }
  return null;
}
