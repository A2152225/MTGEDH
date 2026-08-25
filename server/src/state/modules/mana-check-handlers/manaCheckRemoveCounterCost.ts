// Origin parent: server/src/state/modules/mana-check.ts
// Cluster moved: self-remove-counter cost parse and permanent counter budgets.
// Public entry symbols: parseSelfRemoveCounterCost, getPermanentCounterAmountForManaCheck,
// normalizeManaCheckCounterType.
// Leaf must not import mana-check.ts or mana-check-handlers/index.ts.

const REMOVE_COUNTER_COUNT_WORDS = 'a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+|x';
const REMOVE_COUNTER_COST_PATTERN = new RegExp(
  `\\bremove\\s+(${REMOVE_COUNTER_COUNT_WORDS})\\s+([^,;:]+?)\\s+counters?(?:\\s+from\\s+([^,;:]+))?\\b`,
  'i',
);

export function normalizeManaCheckCounterType(rawTypePhrase: string): string | null {
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

export function parseSelfRemoveCounterCost(
  costText: string,
  permanent?: any,
): { count: number; counterType: string; refersToSource: boolean; matchPattern: RegExp } | null {
  const match = String(costText || '').match(REMOVE_COUNTER_COST_PATTERN);
  if (!match) return null;

  const count = parseRemoveCounterCountToken(String(match[1] || ''));
  const counterType = normalizeManaCheckCounterType(String(match[2] || ''));
  if (count <= 0 || !counterType) return null;

  const sourceRef = String(match[3] || '').trim().toLowerCase();
  const nameLower = String(permanent?.card?.name || '').trim().toLowerCase();
  const refersToSource = !sourceRef
    || /\b(this|this permanent|this artifact|this creature|this land|this enchantment|it|~|source)\b/i.test(sourceRef)
    || (nameLower.length > 0 && sourceRef.includes(nameLower));

  return {
    count,
    counterType,
    refersToSource,
    matchPattern: new RegExp(REMOVE_COUNTER_COST_PATTERN.source, 'i'),
  };
}

export function getPermanentCounterAmountForManaCheck(permanent: any, counterType: string): number {
  const counters = permanent?.counters && typeof permanent.counters === 'object' ? permanent.counters : {};
  const candidates = counterType === '+1/+1'
    ? ['+1/+1', 'p1p1', 'plus_one', 'plusone', 'plus1plus1', '+1+1']
    : counterType === '-1/-1'
      ? ['-1/-1', 'm1m1', 'minus_one', 'minusone', 'minus1minus1', '-1-1']
      : [counterType];
  for (const key of candidates) {
    const amount = Number(counters[key] || 0);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return 0;
}
