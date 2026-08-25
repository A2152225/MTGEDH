// Origin parent: server/src/state/modules/replacementEffectSpec.ts
// Cluster moved: normalizeOraclePatternText + readCardOracleText (oracle-pattern
// collect helpers shared by every template family).
// Public entry symbols: normalizeOraclePatternText, readCardOracleText.
// Leaf must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

export function normalizeOraclePatternText(value: unknown): string {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}


export function readCardOracleText(card: unknown): string {
  if (!card || typeof card !== 'object') return '';
  const record = card as Record<string, unknown>;
  const direct = String(record.oracle_text || record.oracleText || '').trim();
  if (direct) return direct;
  const nested = record.card;
  if (nested && typeof nested === 'object') {
    const nestedRecord = nested as Record<string, unknown>;
    return String(nestedRecord.oracle_text || nestedRecord.oracleText || '').trim();
  }
  return '';
}
