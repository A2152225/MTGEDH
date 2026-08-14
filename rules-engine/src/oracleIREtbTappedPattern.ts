/**
 * Minimal ETB-tapped pattern detection for Oracle IR (mirrors land-helpers.ts).
 */

const ETB_COUNT_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

function parseEtbCountWord(raw: string): number | null {
  const token = String(raw || '').toLowerCase().trim();
  if (!token) return null;
  if (ETB_COUNT_WORDS[token] !== undefined) return ETB_COUNT_WORDS[token];
  const n = Number.parseInt(token, 10);
  return Number.isFinite(n) ? n : null;
}

export function detectETBTappedPattern(oracleText: string): 'always' | 'conditional' | 'never' {
  const text = String(oracleText || '').toLowerCase();
  const etbTappedMatch =
    text.includes('enters the battlefield tapped')
    || text.includes('enters tapped')
    || text.includes('comes into play tapped');

  if (!etbTappedMatch) return 'never';

  const sentences = text.split(/[.!]/);
  const etbSentence = sentences.find((s) =>
    s.includes('enters the battlefield tapped')
    || s.includes('enters tapped')
    || s.includes('comes into play tapped'),
  ) || '';

  const conditionalPatterns = [
    'unless you',
    'unless your',
    'you may pay',
    'if you control',
    "if you don't",
    'if an opponent',
  ];

  for (const pattern of conditionalPatterns) {
    if (etbSentence.includes(pattern)) return 'conditional';
  }

  return 'always';
}

/**
 * Turbulent cycle: "This land enters tapped unless your opponents control eight or more lands."
 * Counts lands among all opponents combined.
 */
export function matchOpponentsControlLandsETB(
  oracleText: string,
  opponentLandCount: number,
): { shouldEnterTapped: boolean; reason: string } | null {
  const text = String(oracleText || '').toLowerCase();
  const match = text.match(
    /(?:this land )?enters(?: the battlefield)? tapped unless your opponents control (\w+|\d+) or more lands/i,
  );
  if (!match) return null;

  const threshold = parseEtbCountWord(match[1] || '');
  if (threshold == null || threshold < 1) return null;

  const count = Math.max(0, Number(opponentLandCount) || 0);
  const shouldEnterTapped = count < threshold;
  return {
    shouldEnterTapped,
    reason: shouldEnterTapped
      ? `Enters tapped (opponents control ${count} land${count !== 1 ? 's' : ''}; need ${threshold}+)`
      : `Enters untapped (opponents control ${count} lands)`,
  };
}
