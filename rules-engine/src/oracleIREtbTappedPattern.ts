/**
 * Minimal ETB-tapped pattern detection for Oracle IR (mirrors land-helpers.ts).
 */
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
