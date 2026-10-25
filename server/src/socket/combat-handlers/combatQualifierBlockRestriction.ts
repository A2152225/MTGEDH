// server/src/socket/combat-handlers/combatQualifierBlockRestriction.ts
// Origin parent: combatLegalityGates.ts (canBlockAttacker).
// Self evasion by blocker quality (generic oracle pattern):
//   "~ can't be blocked by creatures with power N or greater" / "... N or less"
//   "~ can't be blocked by creatures with toughness N or greater" / "... N or less"
//   "~ can't be blocked by artifact creatures" / "... by Walls" / "... by Humans"
//   "~ can't be blocked by creatures with flying"
//   Also static-granted forms (Wall Crawl: "Spiders you control ... can't be blocked by creatures with
//   defender"): callers pass the attacker's continuous granted abilities in attackerTexts, and the
//   blocker's continuous abilities in stats.blockerAbilities so granted keywords count.
// Public entry symbols: parseQualifierBlockRestrictions, getQualifierBlockRestrictionReason.

export type QualifierBlockRestriction =
  | { kind: 'stat'; stat: 'power' | 'toughness'; comparison: 'at_least' | 'at_most'; amount: number; text: string }
  | { kind: 'type'; typeWord: string; text: string }
  | { kind: 'keyword'; keyword: string; text: string };

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const SELF_PREFIX = "(?:^|[\\n.]\\s*)(?:this creature|this permanent|it|~)?\\s*can(?:'t|not) be blocked by ";
const STAT_RE = new RegExp(SELF_PREFIX + '(?:creatures|blockers) with (power|toughness) (\\d+|[a-z]+) or (greater|more|less)\\b', 'gi');
const TYPE_RE = new RegExp(SELF_PREFIX + '(?:(artifact|enchantment|legendary|land|token|snow|colorless|multicolored) creatures|([a-z]+?)s)(?=\\s*(?:$|[.,\\n]))', 'gi');
const KEYWORD_RE = new RegExp(SELF_PREFIX + 'creatures with (flying|reach|defender|first strike|deathtouch|haste|trample)\\b', 'gi');

const NON_SUBTYPE_PLURAL_WORDS = new Set(['creature', 'blocker', 'more than one creature', 'token']);

function normalize(raw: string): string {
  return String(raw || '').replace(/\u2019/g, "'").replace(/\([^)]*\)/g, ' ').toLowerCase();
}

export function parseQualifierBlockRestrictions(texts: readonly string[]): QualifierBlockRestriction[] {
  const out: QualifierBlockRestriction[] = [];
  for (const raw of texts) {
    const text = normalize(raw);
    for (const m of text.matchAll(STAT_RE)) {
      const amount = /^\d+$/.test(m[2]) ? Number(m[2]) : NUMBER_WORDS[m[2]];
      if (!Number.isFinite(amount)) continue;
      out.push({
        kind: 'stat',
        stat: m[1] as 'power' | 'toughness',
        comparison: m[3] === 'less' ? 'at_most' : 'at_least',
        amount,
        text: m[0].trim(),
      });
    }
    for (const m of text.matchAll(TYPE_RE)) {
      const typeWord = String(m[1] || m[2] || '').trim();
      if (!typeWord || NON_SUBTYPE_PLURAL_WORDS.has(typeWord) || /\b(?:white|blue|black|red|green)\b/.test(typeWord)) continue;
      out.push({ kind: 'type', typeWord: typeWord.replace(/(?:ie)$/, 'y'), text: m[0].trim() });
    }
    for (const m of text.matchAll(KEYWORD_RE)) {
      out.push({ kind: 'keyword', keyword: m[1], text: m[0].trim() });
    }
  }
  return out;
}

function typeLineOf(permanent: any): string {
  const effective = Array.isArray(permanent?.effectiveTypes) ? permanent.effectiveTypes.join(' ') : '';
  return `${String(permanent?.card?.type_line || permanent?.type_line || '')} ${effective}`.toLowerCase();
}

function blockerHasType(blocker: any, typeWord: string): boolean {
  const typeLine = typeLineOf(blocker);
  if (typeWord === 'token') return blocker?.isToken === true || /\btoken\b/.test(typeLine);
  if (typeWord === 'colorless') {
    const colors = Array.isArray(blocker?.colors) ? blocker.colors : blocker?.card?.colors;
    return Array.isArray(colors) && colors.length === 0;
  }
  if (typeWord === 'multicolored') {
    const colors = Array.isArray(blocker?.colors) ? blocker.colors : blocker?.card?.colors;
    return Array.isArray(colors) && colors.length > 1;
  }
  const escaped = typeWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(typeLine);
}

function blockerHasKeyword(blocker: any, keyword: string, extra: readonly string[] = []): boolean {
  const keywords: unknown[] = [
    ...extra,
    ...(Array.isArray(blocker?.card?.keywords) ? blocker.card.keywords : []),
    ...(Array.isArray(blocker?.grantedAbilities) ? blocker.grantedAbilities : []),
  ];
  if (keywords.some((entry) => String(entry || '').toLowerCase() === keyword)) return true;
  const oracle = normalize(String(blocker?.card?.oracle_text || ''));
  return oracle.split('\n').some((line) => line.split(/,\s*/).map((part) => part.trim()).includes(keyword));
}

export function getQualifierBlockRestrictionReason(
  attacker: any,
  blocker: any,
  attackerTexts: readonly string[],
  stats: { blockerPower: number; blockerToughness: number; blockerAbilities?: readonly string[] },
): string | null {
  const name = String(attacker?.card?.name || attacker?.name || '').trim();
  const selfRef = (t: string) => {
    if (!name) return t;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);
    return t.replace(new RegExp('\\b' + esc + '\\b', 'gi'), () => '~');
  };
  const restrictions = parseQualifierBlockRestrictions([
    String(attacker?.card?.oracle_text || ''),
    String(attacker?.oracle_text || ''),
    ...attackerTexts,
  ].map(selfRef));
  for (const restriction of restrictions) {
    if (restriction.kind === 'stat') {
      const value = restriction.stat === 'power' ? stats.blockerPower : stats.blockerToughness;
      if (!Number.isFinite(value)) continue;
      const hit = restriction.comparison === 'at_least' ? value >= restriction.amount : value <= restriction.amount;
      if (hit) return `Attacker ${restriction.text.replace(/^[\n.\s]+/, '')}`;
    } else if (restriction.kind === 'type') {
      if (blockerHasType(blocker, restriction.typeWord)) return `Attacker ${restriction.text.replace(/^[\n.\s]+/, '')}`;
    } else if (blockerHasKeyword(blocker, restriction.keyword, stats.blockerAbilities)) {
      return `Attacker ${restriction.text.replace(/^[\n.\s]+/, '')}`;
    }
  }
  return null;
}
