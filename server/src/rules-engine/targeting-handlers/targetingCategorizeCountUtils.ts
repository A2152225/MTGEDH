// server/src/rules-engine/targeting-handlers/targetingCategorizeCountUtils.ts
// Origin parent: server/src/rules-engine/targeting.ts
// Cluster moved: parseCountWord and titleCaseWords, used by categorizeSpell
//   pattern-family leaves.
// Public entry symbols: parseCountWord, titleCaseWords.

export function parseCountWord(raw: string | undefined): number | null {
  if (!raw) return null;
  const t = String(raw).trim().toLowerCase();
  if (!t) return null;
  if (t === 'a' || t === 'an' || t === 'one') return 1;
  const wordToNumber: Record<string, number> = {
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  if (wordToNumber[t] !== undefined) return wordToNumber[t];
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return null;
}

export function titleCaseWords(raw: string): string {
  return String(raw)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(word =>
      word
        .split('-')
        .map(part => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
        .join('-')
    )
    .join(' ');
}

