/**
 * oracleIRSelectorExclusionQualifier.ts
 *
 * Origin: oracleIRExecutorBattlefieldParser.ts (parseSimpleBattlefieldSelector) /
 * oracleIRSelectorKeywordQualifier.ts (permanentMatchesSelectorKeywords).
 * Cluster: negated-descriptor and blocking qualifiers on simple battlefield selectors -
 * "each nonwhite creature", "each nonlegendary creature", "each non-Zombie creature",
 * "each blocking creature", plus the "other ... defending player controls" antecedent exclusion.
 * Reserved words (nonland, noncreature, nontoken, nonbasic) stay with the existing parser paths.
 *
 * Public entries: splitSelectorExclusions, permanentMatchesSelectorExclusions,
 * permanentIsExcludedAntecedentCreature, isBlockingPermanent.
 */

export type SelectorExclusionFilter = {
  readonly colorsNoneOf?: readonly string[];
  readonly typeLineTermsNoneOf?: readonly string[];
  readonly blockingOnly?: boolean;
};

const COLOR_WORD_TO_LETTER: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

/** "non<word>" prefixes owned by other parser paths. */
const RESERVED_NON_WORDS = new Set(['land', 'creature', 'token', 'basic', 'permanent']);

export function splitSelectorExclusions(remainder: string): {
  readonly remainder: string;
} & SelectorExclusionFilter {
  let rest = String(remainder || '').trim();
  const colorsNoneOf: string[] = [];
  const typeLineTermsNoneOf: string[] = [];
  let blockingOnly = false;

  for (;;) {
    const match = rest.match(/^non-?([a-z]+)\s+(.+)$/i);
    if (!match) break;
    const word = String(match[1] || '').toLowerCase();
    if (RESERVED_NON_WORDS.has(word)) break;
    const letter = COLOR_WORD_TO_LETTER[word];
    if (letter) colorsNoneOf.push(letter);
    else typeLineTermsNoneOf.push(word);
    rest = String(match[2] || '').trim();
  }

  const blocking = rest.match(/^blocking\s+(creatures?)$/i);
  if (blocking) {
    blockingOnly = true;
    rest = String(blocking[1] || '').trim();
  }

  if (colorsNoneOf.length === 0 && typeLineTermsNoneOf.length === 0 && !blockingOnly) {
    return { remainder: String(remainder || '').trim() };
  }
  return {
    remainder: rest,
    ...(colorsNoneOf.length > 0 ? { colorsNoneOf } : {}),
    ...(typeLineTermsNoneOf.length > 0 ? { typeLineTermsNoneOf } : {}),
    ...(blockingOnly ? { blockingOnly: true } : {}),
  };
}

function readPermanentColorLetters(perm: any): string[] {
  const colors = Array.isArray(perm?.colors)
    ? perm.colors
    : Array.isArray(perm?.card?.colors)
      ? perm.card.colors
      : [];
  const letters: string[] = [];
  for (const color of colors) {
    const normalized = String(color || '').trim().toLowerCase();
    if (!normalized) continue;
    const fromWord = COLOR_WORD_TO_LETTER[normalized];
    if (fromWord) letters.push(fromWord);
    else if (normalized.length === 1) letters.push(normalized.toUpperCase());
  }
  return letters;
}

function readPermanentTypeLineLower(perm: any): string {
  return String(
    perm?.card?.type_line || perm?.card?.typeLine || perm?.type_line || perm?.typeLine || '',
  ).toLowerCase();
}

export function isBlockingPermanent(perm: any): boolean {
  const blocking = perm?.blocking;
  if (Array.isArray(blocking)) return blocking.length > 0;
  if (typeof blocking === 'string') return blocking.trim().length > 0;
  return blocking === true || perm?.isBlocking === true;
}

export function permanentMatchesSelectorExclusions(perm: unknown, sel: SelectorExclusionFilter): boolean {
  if (sel.blockingOnly && !isBlockingPermanent(perm)) return false;

  if (sel.colorsNoneOf && sel.colorsNoneOf.length > 0) {
    const letters = readPermanentColorLetters(perm);
    if (sel.colorsNoneOf.some((color) => letters.includes(color))) return false;
  }

  if (sel.typeLineTermsNoneOf && sel.typeLineTermsNoneOf.length > 0) {
    const typeLine = readPermanentTypeLineLower(perm);
    const subtypeWords = typeLine.split(/[\s\u2014\u2013-]+/).filter(Boolean);
    for (const term of sel.typeLineTermsNoneOf) {
      const normalized = String(term || '').toLowerCase();
      if (subtypeWords.includes(normalized) || subtypeWords.includes(`${normalized}s`)) return false;
    }
  }
  return true;
}

/**
 * "each other creature defending player controls": "other" means other than the creature that was
 * just dealt damage / the combat opponent, so exclude those antecedent ids.
 */
export function permanentIsExcludedAntecedentCreature(
  perm: unknown,
  sel: { readonly excludeAntecedentCreature?: boolean },
  ctx: {
    readonly lastDamagedBattlefieldPermanentIds?: readonly string[];
    readonly lastReferencedPermanentId?: string;
    readonly targetCreatureId?: string;
    readonly targetPermanentId?: string;
    readonly selectorContext?: { readonly combatOpponentCreatureId?: string; readonly targetCreatureId?: string };
  },
): boolean {
  if (!sel.excludeAntecedentCreature) return false;
  const id = String((perm as any)?.id || '').trim();
  if (!id) return false;
  const antecedents = [
    ...(Array.isArray(ctx.lastDamagedBattlefieldPermanentIds) ? ctx.lastDamagedBattlefieldPermanentIds : []),
    ctx.lastReferencedPermanentId,
    ctx.targetCreatureId,
    ctx.targetPermanentId,
    ctx.selectorContext?.combatOpponentCreatureId,
    ctx.selectorContext?.targetCreatureId,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return antecedents.includes(id);
}
