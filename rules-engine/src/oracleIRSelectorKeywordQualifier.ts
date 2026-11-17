import { permanentHasKeywordAbility } from './permanentKeywordAbilities';
import { permanentMatchesSelectorExclusions } from './oracleIRSelectorExclusionQualifier';

/** Evergreen keywords a "creature with/without <keyword>" selector may filter on. */
const SELECTOR_KEYWORDS = [
  'flying', 'reach', 'trample', 'haste', 'vigilance', 'deathtouch', 'lifelink', 'defender',
  'first strike', 'double strike', 'menace', 'hexproof', 'indestructible', 'shroud', 'flash',
  'flanking',
];

const KEYWORD_ALT = SELECTOR_KEYWORDS.join('|');
const KEYWORD_SUFFIX = new RegExp(`\\s+(with|without)\\s+(${KEYWORD_ALT})$`, 'i');
const KEYWORD_OR_SUFFIX = new RegExp(
  `\\s+with\\s+((?:${KEYWORD_ALT})(?:\\s+or\\s+(?:${KEYWORD_ALT}))+)$`,
  'i',
);
const KEYWORD_NONE_LIST_SUFFIX = new RegExp(
  `\\s+that (?:does|do)n'?t have\\s+((?:${KEYWORD_ALT})(?:\\s*,\\s*(?:${KEYWORD_ALT}))*(?:\\s*,?\\s*or\\s+(?:${KEYWORD_ALT})))$`,
  'i',
);

function splitKeywordList(raw: string): string[] {
  return String(raw || '')
    .split(/\s*,\s*(?:or\s+)?|\s+or\s+/i)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

/** Splits "creatures without flying" into the bare noun phrase and its keyword filter. */
export function splitSelectorKeywordQualifier(remainder: string): {
  readonly remainder: string;
  readonly keywordsAll?: readonly string[];
  readonly keywordsNone?: readonly string[];
  readonly keywordsAny?: readonly string[];
} {
  const text = String(remainder || '');
  const noneList = text.match(KEYWORD_NONE_LIST_SUFFIX);
  if (noneList) {
    return {
      remainder: text.slice(0, noneList.index).trim(),
      keywordsNone: splitKeywordList(noneList[1]),
    };
  }
  const anyList = text.match(KEYWORD_OR_SUFFIX);
  if (anyList) {
    return {
      remainder: text.slice(0, anyList.index).trim(),
      keywordsAny: splitKeywordList(anyList[1]),
    };
  }
  const match = text.match(KEYWORD_SUFFIX);
  if (!match) return { remainder };
  const keyword = String(match[2] || '').toLowerCase();
  const rest = text.slice(0, match.index).trim();
  return String(match[1]).toLowerCase() === 'with'
    ? { remainder: rest, keywordsAll: [keyword] }
    : { remainder: rest, keywordsNone: [keyword] };
}

export function permanentMatchesSelectorKeywords(
  perm: unknown,
  sel: {
    readonly keywordsAll?: readonly string[];
    readonly keywordsNone?: readonly string[];
    readonly keywordsAny?: readonly string[];
    readonly colorsNoneOf?: readonly string[];
    readonly typeLineTermsNoneOf?: readonly string[];
    readonly blockingOnly?: boolean;
  },
  battlefield?: readonly unknown[],
): boolean {
  if (!permanentMatchesSelectorExclusions(perm, sel)) return false;
  for (const keyword of sel.keywordsAll || []) {
    if (!permanentHasKeywordAbility(perm, keyword, battlefield as any[])) return false;
  }
  for (const keyword of sel.keywordsNone || []) {
    if (permanentHasKeywordAbility(perm, keyword, battlefield as any[])) return false;
  }
  const any = sel.keywordsAny || [];
  if (any.length > 0 && !any.some((keyword) => permanentHasKeywordAbility(perm, keyword, battlefield as any[]))) {
    return false;
  }
  return true;
}
