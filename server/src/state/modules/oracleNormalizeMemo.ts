// server/src/state/modules/oracleNormalizeMemo.ts
// Origin parent: batch104Parsers.ts / batch107Parsers.ts / batch108Parsers.ts /
//   batch110Parsers.ts / batch111Parsers.ts / batch112Parsers.ts (new, no code moved).
// Cluster: bounded memo for the pure oracle-text normalisers those parsers run on every
//   permanent for every continuous-effects recompute. They are functions of
//   (oracle text, card name) only, and a CPU profile of a stalled self-play tick showed
//   64% of self time inside them (regex compile + replace on unchanged strings).
// Public entry symbols: memoOracleNormalize.

const MAX_ENTRIES = 50_000;
const caches = new Map<string, Map<string, Map<string, string>>>();
let entryCount = 0;

/**
 * Returns compute(text, cardName), remembered per (cacheId, cardName, text).
 * Non-string input is not cached. The whole store is dropped when it reaches MAX_ENTRIES.
 */
export function memoOracleNormalize(
  cacheId: string,
  text: unknown,
  cardName: unknown,
  compute: () => string,
): string {
  if (typeof text !== 'string' || (cardName !== undefined && typeof cardName !== 'string')) return compute();
  let byName = caches.get(cacheId);
  if (!byName) {
    byName = new Map();
    caches.set(cacheId, byName);
  }
  const nameKey = typeof cardName === 'string' ? cardName : '';
  let byText = byName.get(nameKey);
  if (!byText) {
    byText = new Map();
    byName.set(nameKey, byText);
  }
  const cached = byText.get(text);
  if (cached !== undefined) return cached;
  const value = compute();
  if (entryCount >= MAX_ENTRIES) {
    caches.clear();
    entryCount = 0;
    return value;
  }
  byText.set(text, value);
  entryCount += 1;
  return value;
}
