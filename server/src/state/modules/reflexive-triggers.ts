export type ReflexiveManaPaymentUnit = 'mana' | '{W}' | '{U}' | '{B}' | '{R}' | '{G}' | '{C}';

export interface ReflexiveAnyAmountManaPayment {
  paymentUnit: ReflexiveManaPaymentUnit;
  followupText: string;
}

const MANA_SYMBOL_TO_POOL_KEY: Record<string, 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless'> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colorless',
};

const GENERIC_SPEND_ORDER: Array<'colorless' | 'white' | 'blue' | 'black' | 'red' | 'green'> = [
  'colorless',
  'white',
  'blue',
  'black',
  'red',
  'green',
];

export function parseReflexiveAnyAmountManaPayment(effectText: string): ReflexiveAnyAmountManaPayment | null {
  const normalized = String(effectText || '')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(/^(?:you\s+may\s+)?pay\s+any\s+amount\s+of\s+(\{[WUBRGC]\}|mana)\.\s*when\s+you\s+do,?\s*([\s\S]+)$/i);
  if (!match) return null;

  const rawUnit = String(match[1] || '').trim();
  const paymentUnit = rawUnit.toLowerCase() === 'mana'
    ? 'mana'
    : (`{${rawUnit.replace(/[{}]/g, '').toUpperCase()}}` as ReflexiveManaPaymentUnit);
  const followupText = String(match[2] || '').trim();
  if (!followupText) return null;

  return { paymentUnit, followupText };
}

export function formatReflexiveManaAmount(amount: number, paymentUnit: ReflexiveManaPaymentUnit): string {
  const normalizedAmount = Math.max(0, Math.floor(Number(amount || 0)));
  if (paymentUnit === 'mana') {
    return `${normalizedAmount} mana`;
  }

  return `${normalizedAmount} ${paymentUnit}`;
}

export function buildReflexivePaymentAmountOptions(maxAmount: number, paymentUnit: ReflexiveManaPaymentUnit): { id: string; label: string; description?: string }[] {
  const max = Math.max(0, Math.floor(Number(maxAmount || 0)));
  const options: { id: string; label: string; description?: string }[] = [];
  for (let amount = 1; amount <= max; amount++) {
    options.push({
      id: `pay_${amount}`,
      label: `Pay ${formatReflexiveManaAmount(amount, paymentUnit)}`,
      description: `Trigger the reflexive follow-up with X = ${amount}.`,
    });
  }
  options.push({ id: 'decline', label: 'Decline', description: 'Do not pay.' });
  return options;
}

export function parseReflexivePaymentChoiceAmount(choiceId: string | null | undefined): number {
  const match = String(choiceId || '').trim().toLowerCase().match(/^pay_(\d+)$/);
  if (!match) return 0;
  const amount = Number.parseInt(String(match[1] || '0'), 10);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

export function getAvailableReflexiveManaAmountFromPool(state: any, playerId: string, paymentUnit: ReflexiveManaPaymentUnit): number {
  const pool = state?.manaPool?.[playerId] || {};
  if (paymentUnit !== 'mana') {
    const symbol = paymentUnit.replace(/[{}]/g, '').toUpperCase();
    const poolKey = MANA_SYMBOL_TO_POOL_KEY[symbol];
    return poolKey ? Math.max(0, Math.floor(Number(pool[poolKey] || 0))) : 0;
  }

  return GENERIC_SPEND_ORDER.reduce((sum, poolKey) => sum + Math.max(0, Math.floor(Number(pool[poolKey] || 0))), 0);
}

export function consumeReflexiveManaAmountFromPool(state: any, playerId: string, paymentUnit: ReflexiveManaPaymentUnit, amount: number): void {
  const paymentAmount = Math.max(0, Math.floor(Number(amount || 0)));
  if (paymentAmount <= 0) return;

  state.manaPool = state.manaPool || {};
  const pool = state.manaPool[playerId] = state.manaPool[playerId] || {
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    colorless: 0,
  };

  if (paymentUnit !== 'mana') {
    const symbol = paymentUnit.replace(/[{}]/g, '').toUpperCase();
    const poolKey = MANA_SYMBOL_TO_POOL_KEY[symbol];
    if (!poolKey) return;
    pool[poolKey] = Math.max(0, Number(pool[poolKey] || 0) - paymentAmount);
    return;
  }

  let remaining = paymentAmount;
  for (const poolKey of GENERIC_SPEND_ORDER) {
    if (remaining <= 0) break;
    const available = Math.max(0, Number(pool[poolKey] || 0));
    if (available <= 0) continue;
    const spent = Math.min(available, remaining);
    pool[poolKey] = available - spent;
    remaining -= spent;
  }
}

export function materializeReflexiveFollowupText(followupText: string, sourceName: string, amount: number): string {
  const source = String(sourceName || 'This source').trim() || 'This source';
  let text = String(followupText || '')
    .replace(/[’]/g, "'")
    .replace(/\bthat much\b/gi, String(Math.max(0, Math.floor(Number(amount || 0)))))
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return text;

  text = text.replace(/^it\b/i, source);
  text = text.replace(/^this\s+(?:creature|permanent|artifact|enchantment|vehicle)\b/i, source);
  if (/^deals?\s+/i.test(text)) {
    text = `${source} ${text.replace(/^deal\b/i, 'deals')}`;
  }

  return text;
}