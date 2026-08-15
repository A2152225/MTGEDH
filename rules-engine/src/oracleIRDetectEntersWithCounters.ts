/**
 * Detect "enters with counters" patterns from a card's oracle text.
 */
export function detectEntersWithCounters(card: any): Record<string, number> {
  const counters: Record<string, number> = {};
  if (!card) return counters;

  const oracleText = (card.oracle_text || '').toLowerCase();
  const typeLine = (card.type_line || '').toLowerCase();
  const castWithAbility = String((card as any)?.castWithAbility || '').trim().toLowerCase();

  const counterPattern =
    /(?:~|this creature)\s+(?:enters|comes into play)(?: the battlefield)? with (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s*([+\-\d\/]+|\w+)\s*counters?\s*(?:on it)?/gi;

  const matchedRanges = new Set<string>();
  let match;
  counterPattern.lastIndex = 0;
  while ((match = counterPattern.exec(oracleText)) !== null) {
    const matchKey = `${match.index}-${match[0].length}`;
    if (matchedRanges.has(matchKey)) continue;
    matchedRanges.add(matchKey);

    const countStr = match[1].toLowerCase();
    const counterType = match[2].trim();

    const wordToNum: Record<string, number> = {
      a: 1,
      an: 1,
      one: 1,
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
    const count = wordToNum[countStr] !== undefined ? wordToNum[countStr] : parseInt(countStr, 10);

    if (!isNaN(count) && count > 0) {
      counters[counterType] = (counters[counterType] || 0) + count;
    }
  }

  if (castWithAbility === 'escape') {
    const escapeCounterPattern =
      /(?:~|this creature|it)\s+escapes?\s+with\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s*([+\-\d\/]+|\w+)\s*counters?\s*(?:on it)?/gi;
    escapeCounterPattern.lastIndex = 0;
    while ((match = escapeCounterPattern.exec(oracleText)) !== null) {
      const countStr = match[1].toLowerCase();
      const counterType = match[2].trim();

      const wordToNum: Record<string, number> = {
        a: 1,
        an: 1,
        one: 1,
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
      const count = wordToNum[countStr] !== undefined ? wordToNum[countStr] : parseInt(countStr, 10);

      if (!isNaN(count) && count > 0) {
        counters[counterType] = (counters[counterType] || 0) + count;
      }
    }
  }

  if (typeLine.includes('saga')) {
    counters.lore = (counters.lore || 0) + 1;
  }

  const modularMatch = oracleText.match(/modular\s+(\d+)/i);
  if (modularMatch) {
    const n = parseInt(modularMatch[1], 10);
    if (!isNaN(n) && n > 0) {
      counters['+1/+1'] = (counters['+1/+1'] || 0) + n;
    }
  }

  // Fabricate (CR 702.123) is a triggered ETB choice, not an enters-with-counters effect.

  if (oracleText.includes('unleash')) {
    counters['+1/+1'] = (counters['+1/+1'] || 0) + 1;
  }

  return counters;
}
