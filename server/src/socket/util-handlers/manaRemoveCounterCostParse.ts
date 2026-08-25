// server/src/socket/util-handlers/manaRemoveCounterCostParse.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: remove-counter activation-cost parsing, counter-key lookup,
//   and the thin resolveRemoveCounterCostFromActivation wrapper.
// Public entry symbols: ParsedRemoveCounterActivationCost,
//   parseRemoveCounterActivationCost, getPermanentCounterKeyCandidates,
//   getPermanentCounterAmount, resolvePermanentCounterKey,
//   resolveRemoveCounterCostFromActivation, normalizeRemoveCounterTypePhrase.
// Re-exported from util.ts so the "./util.js" import path keeps working.

const REMOVE_COUNTER_COUNT_WORDS = 'a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+|x';
const REMOVE_COUNTER_COST_PATTERN = new RegExp(
  `\\bremove\\s+(${REMOVE_COUNTER_COUNT_WORDS})\\s+([^,;:]+?)\\s+counters?(?:\\s+from\\s+([^,;:]+))?\\b`,
  'i',
);

export type ParsedRemoveCounterActivationCost = {
  count: number;
  counterType: string;
  refersToSource: boolean;
  matchText: string;
  matchPattern: RegExp;
};

export function normalizeRemoveCounterTypePhrase(rawTypePhrase: string): string | null {
  let counterType = String(rawTypePhrase || '')
    .trim()
    .toLowerCase()
    .replace(/^\s*(?:a|an)\s+/i, '')
    .replace(/\s+from\b.*$/i, '')
    .replace(/\s+/g, ' ');
  if (!counterType) return null;
  if (/\+\s*1\s*\/\s*\+\s*1/i.test(counterType) || /\bplus\s*one\b/.test(counterType)) return '+1/+1';
  if (/-\s*1\s*\/\s*-\s*1/i.test(counterType) || /\bminus\s*one\b/.test(counterType)) return '-1/-1';
  if (/^\d+\s*\/\s*\d+$/i.test(counterType)) return null;
  const first = counterType.split(/\s+/)[0];
  return String(first || '').toLowerCase() || null;
}

function parseRemoveCounterCountToken(rawCount: string): number {
  const normalized = String(rawCount || '').trim().toLowerCase();
  if (!normalized || normalized === 'x') return 0;
  const wordMap: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  if (Object.prototype.hasOwnProperty.call(wordMap, normalized)) {
    return wordMap[normalized];
  }
  const asNumber = Number.parseInt(normalized, 10);
  return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : 0;
}

/**
 * Parse "Remove N <counter> counter(s) [from <source>]" activation costs.
 * Missing "from ..." is treated as removing from the source permanent.
 */
export function parseRemoveCounterActivationCost(
  costText: string,
  sourceCardName?: string,
): ParsedRemoveCounterActivationCost | null {
  const match = String(costText || '').match(REMOVE_COUNTER_COST_PATTERN);
  if (!match) return null;

  const count = parseRemoveCounterCountToken(String(match[1] || ''));
  const counterType = normalizeRemoveCounterTypePhrase(String(match[2] || ''));
  if (count <= 0 || !counterType) return null;

  const sourceRef = String(match[3] || '').trim().toLowerCase();
  const nameLower = String(sourceCardName || '').trim().toLowerCase();
  const refersToSource = !sourceRef
    || /\b(this|this permanent|this artifact|this creature|this land|this enchantment|it|~|source)\b/i.test(sourceRef)
    || (nameLower.length > 0 && sourceRef.includes(nameLower));

  return {
    count,
    counterType,
    refersToSource,
    matchText: String(match[0] || ''),
    matchPattern: new RegExp(REMOVE_COUNTER_COST_PATTERN.source, 'i'),
  };
}

export function getPermanentCounterKeyCandidates(counterType: string): string[] {
  const ct = String(counterType || '');
  if (ct === '+1/+1') return ['+1/+1', 'p1p1', 'plus_one', 'plusone', 'plus1plus1', '+1+1'];
  if (ct === '-1/-1') return ['-1/-1', 'm1m1', 'minus_one', 'minusone', 'minus1minus1', '-1-1'];
  return [ct];
}

export function getPermanentCounterAmount(permanent: any, counterType: string): number {
  const counters = permanent?.counters && typeof permanent.counters === 'object' ? permanent.counters : {};
  for (const key of getPermanentCounterKeyCandidates(counterType)) {
    const amount = Number(counters[key] || 0);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return 0;
}

export function resolvePermanentCounterKey(permanent: any, counterType: string, requiredCount: number = 1): string | null {
  const counters = permanent?.counters && typeof permanent.counters === 'object' ? permanent.counters : {};
  const needed = Math.max(1, Number(requiredCount || 1));
  return getPermanentCounterKeyCandidates(counterType).find((key) => Number(counters[key] || 0) >= needed) || null;
}

export function resolveRemoveCounterCostFromActivation(
  activationCost: string,
  sourceCardName?: string,
): ParsedRemoveCounterActivationCost | null {
  return parseRemoveCounterActivationCost(activationCost, sourceCardName);
}
