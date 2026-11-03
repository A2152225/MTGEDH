// server/src/state/modules/spellConvokeGrantTemplate.ts
// B44: generic "<qualifiers> spells you cast [from <zone>] have convoke." template
// (Hoarding Broodlord "Spells you cast from exile", Party Thrasher "Noncreature spells you cast from exile", type / color qualifiers).
// Origin parent: casting-modifiers.ts (getStaticConvokeGrantScopesFromBattlefield).
// Public entry symbols: templateConvokeGrantMatch.

const TEMPLATE_RE = /\b((?:[a-z]+(?: and | or |, | ))*?)spells you cast(?: from (exile|your graveyard|your hand|a graveyard|anywhere other than your hand))? have convoke\b/i;
const TYPES = ['creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'planeswalker', 'land', 'battle', 'kindred', 'legendary'];
const COLORS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

function colorsOf(card: any): string[] {
  if (Array.isArray(card?.colors)) return card.colors.map((c: any) => String(c).toUpperCase());
  const cost = String(card?.mana_cost || card?.manaCost || '').toUpperCase();
  return ['W', 'U', 'B', 'R', 'G'].filter((c) => cost.includes(c));
}

function wordMatches(word: string, card: any): boolean | null {
  const typeLine = String(card?.type_line || card?.typeLine || '').toLowerCase();
  const neg = word.startsWith('non');
  const base = neg ? word.slice(3).replace(/^-/, '') : word;
  let hit: boolean;
  if (TYPES.includes(base)) hit = typeLine.includes(base);
  else if (COLORS[base]) hit = colorsOf(card).includes(COLORS[base]);
  else if (base === 'multicolored') hit = colorsOf(card).length > 1;
  else if (base === 'colorless') hit = colorsOf(card).length === 0;
  else if (base === 'historic') hit = typeLine.includes('legendary') || typeLine.includes('artifact') || typeLine.includes('saga');
  else return null;
  return neg ? !hit : hit;
}

function zoneMatches(zone: string | undefined, castSourceZone?: string): boolean {
  if (!zone) return true;
  const src = String(castSourceZone || 'hand').toLowerCase();
  if (zone === 'exile') return src === 'exile';
  if (zone === 'your graveyard' || zone === 'a graveyard') return src === 'graveyard';
  if (zone === 'your hand') return src === 'hand';
  return src !== 'hand';
}

/** null when the text is not a supported template (caller falls back); otherwise whether this spell gets convoke. */
export function templateConvokeGrantMatch(oracleText: string, card: any, castSourceZone?: string): boolean | null {
  const m = String(oracleText || '').match(TEMPLATE_RE);
  if (!m) return null;
  const qual = String(m[1] || '').trim().toLowerCase();
  if (/\b(?:the|first|next|each|this|that)\b/.test(qual)) return null;
  if (!zoneMatches(m[2] ? m[2].toLowerCase() : undefined, castSourceZone)) return false;
  if (!qual) return true;
  const disjunctive = /\b(?:and|or)\b|,/.test(qual);
  const words = qual.split(/,|\band\b|\bor\b|\s+/).map((w) => w.trim()).filter(Boolean);
  const results = words.map((w) => wordMatches(w, card));
  if (results.some((r) => r === null)) return null;
  // "Instant and sorcery spells" / "red or green spells" read as either; "noncreature artifact spells" read as both.
  return disjunctive ? results.some(Boolean) : results.every(Boolean);
}
