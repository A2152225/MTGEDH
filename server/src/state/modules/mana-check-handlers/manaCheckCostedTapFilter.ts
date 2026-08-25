// Origin parent: server/src/state/modules/mana-check.ts
// Cluster moved: filterOutCostedTapMatches (drop no-cost tap hits inside costed abilities).
// Public entry symbols: filterOutCostedTapMatches.
// Leaf must not import mana-check.ts or mana-check-handlers/index.ts.

export function filterOutCostedTapMatches(
  noCostMatches: RegExpMatchArray[],
  costMatches: RegExpMatchArray[],
): RegExpMatchArray[] {
  return noCostMatches.filter((match) => {
    const matchIndex = typeof match.index === 'number' ? match.index : -1;
    if (matchIndex < 0) return true;

    return !costMatches.some((costMatch) => {
      const costIndex = typeof costMatch.index === 'number' ? costMatch.index : -1;
      if (costIndex < 0) return false;
      const costEnd = costIndex + String(costMatch[0] || '').length;
      return matchIndex >= costIndex && matchIndex < costEnd;
    });
  });
}
