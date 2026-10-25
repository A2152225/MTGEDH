/**
 * Type filter for "When you discard a [type] card this way, ..." reflexive discards.
 * Public: discardedCardMatchesTypeFilter, anyDiscardedCardMatchesTypeFilter.
 */

/** True when the card's type line satisfies a filter such as "nonland", "creature", "instant or sorcery". */
export function discardedCardMatchesTypeFilter(card: any, filter: string | undefined): boolean {
  const f = String(filter || '').trim().toLowerCase();
  if (!f) return true;
  const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
  return f.split(/\s+or\s+|\s*,\s*/).filter(Boolean).some((part) => {
    const words = part.trim().split(/\s+/).filter(Boolean);
    return words.every((w) => {
      const neg = /^non-?(.+)$/.exec(w);
      if (neg) return !new RegExp(`\\b${neg[1]}\\b`).test(typeLine);
      return new RegExp(`\\b${w}\\b`).test(typeLine);
    });
  });
}

export function anyDiscardedCardMatchesTypeFilter(cards: readonly any[], filter: string | undefined): boolean {
  if (!String(filter || '').trim()) return true;
  return (Array.isArray(cards) ? cards : []).some((card) => discardedCardMatchesTypeFilter(card, filter));
}
