import { permanentHasKeywordAbility } from './permanentKeywordAbilities';

/** Evergreen keywords a "creature with/without <keyword>" selector may filter on. */
const SELECTOR_KEYWORDS = [
  'flying', 'reach', 'trample', 'haste', 'vigilance', 'deathtouch', 'lifelink', 'defender',
  'first strike', 'double strike', 'menace', 'hexproof', 'indestructible', 'shroud', 'flash',
];

const KEYWORD_SUFFIX = new RegExp(`\\s+(with|without)\\s+(${SELECTOR_KEYWORDS.join('|')})$`, 'i');

/** Splits "creatures without flying" into the bare noun phrase and its keyword filter. */
export function splitSelectorKeywordQualifier(remainder: string): {
  readonly remainder: string;
  readonly keywordsAll?: readonly string[];
  readonly keywordsNone?: readonly string[];
} {
  const match = String(remainder || '').match(KEYWORD_SUFFIX);
  if (!match) return { remainder };
  const keyword = String(match[2] || '').toLowerCase();
  const rest = String(remainder).slice(0, match.index).trim();
  return String(match[1]).toLowerCase() === 'with'
    ? { remainder: rest, keywordsAll: [keyword] }
    : { remainder: rest, keywordsNone: [keyword] };
}

export function permanentMatchesSelectorKeywords(
  perm: unknown,
  sel: { readonly keywordsAll?: readonly string[]; readonly keywordsNone?: readonly string[] },
  battlefield?: readonly unknown[],
): boolean {
  for (const keyword of sel.keywordsAll || []) {
    if (!permanentHasKeywordAbility(perm, keyword, battlefield as any[])) return false;
  }
  for (const keyword of sel.keywordsNone || []) {
    if (permanentHasKeywordAbility(perm, keyword, battlefield as any[])) return false;
  }
  return true;
}