import { consumeRepeatCostPaymentFromPool, getMaxRepeatCostPaymentsFromPool, isRepeatCostPaymentUnit, materializeThatManyCount } from './reflexiveRepeatCostPayment.js';
export type ReflexiveManaPaymentUnit = 'mana' | '{W}' | '{U}' | '{B}' | '{R}' | '{G}' | '{C}' | `{${string}}${string}`;

export interface ReflexiveAnyAmountManaPayment {
  paymentUnit: ReflexiveManaPaymentUnit;
  followupText: string;
}

export interface ReflexiveFixedPaymentWhenYouDo {
  paymentText: string;
  manaCost?: string;
  lifeAmount?: number;
  followupText: string;
}

/** Processor-style: put N opponent-owned cards from exile into owners' GYs, then followup. */
export interface ReflexiveExileToOwnersGraveyardWhenYouDo {
  putCount: number;
  ownerScope: 'opponent' | 'opponents';
  followupText: string;
}

export interface ReflexiveSacrificeWhenYouDo {
  sacrificeType: string;
  followupText: string;
}

export interface ReflexiveDiscardWhenYouDo {
  discardCount: number;
  followupText: string;
  /** "When you discard a [type] card this way": the type the discarded card must have. */
  typeFilter?: string;
}

export interface ReflexiveConvertWhenYouDo {
  subjectText: string;
  isMayAbility: boolean;
  followupText: string;
}

export interface ReflexiveGraveyardExileWhenYouDo {
  exileCount: number;
  cardType?: string;
  followupText: string;
}

export interface ReflexiveBoundGraveyardSelfExileWhenYouDo {
  selfReference: 'it' | 'this card';
  followupConnector: 'when' | 'if';
  preludeText?: string;
  followupText: string;
}

export interface ReflexiveConditionalBattlefieldSelfExileWhenYouDo {
  preludeText: string;
  selfReferenceType: string;
  conditionCounterType: string;
  followupText: string;
}

const REFLEXIVE_NUMBER_WORDS: Record<string, number> = {
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

/** Normalize oracle fragments for reflexive If/When-you-do matching. */
export function normalizeReflexiveEffectText(effectText: string): string {
  return String(effectText || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:when|whenever)\s+you\s+cast\s+(?:this\s+spell|this\s+creature|~|this\s+card)\s*,?\s*/i, '')
    .trim();
}

export function parseReflexiveAnyAmountManaPayment(effectText: string): ReflexiveAnyAmountManaPayment | null {
  const normalized = normalizeReflexiveEffectText(effectText);
  if (!normalized) return null;

  const match = normalized.match(/^(?:you\s+may\s+)?pay\s+any\s+amount\s+of\s+(\{[WUBRGC]\}|mana)\.\s*(?:when|if)\s+you\s+do,?\s*([\s\S]+)$/i);
  if (!match) return null;

  const rawUnit = String(match[1] || '').trim();
  const paymentUnit = rawUnit.toLowerCase() === 'mana'
    ? 'mana'
    : (`{${rawUnit.replace(/[{}]/g, '').toUpperCase()}}` as ReflexiveManaPaymentUnit);
  const followupText = String(match[2] || '').trim();
  if (!followupText) return null;

  return { paymentUnit, followupText };
}

export function parseReflexiveFixedPaymentWhenYouDo(effectText: string): ReflexiveFixedPaymentWhenYouDo | null {
  const normalized = normalizeReflexiveEffectText(effectText);
  if (!normalized || /\bpay\s+any\s+amount\b/i.test(normalized)) return null;

  const match = normalized.match(/^(?:you\s+may\s+)?pay\s+((?:(?:\{[^}]+\})+|\d+\s+life)(?:\s+and\s+(?:(?:\{[^}]+\})+|\d+\s+life))?)\.\s*(?:when|if)\s+you\s+do,?\s*([\s\S]+)$/i);
  if (!match) return null;

  const paymentText = String(match[1] || '').replace(/\s+/g, ' ').trim();
  const followupText = String(match[2] || '').trim();
  if (!paymentText || !followupText) return null;

  const manaTokens = paymentText.match(/\{[^}]+\}/g) || [];
  const manaCost = manaTokens.length > 0 ? manaTokens.join('') : undefined;
  const lifeMatch = paymentText.match(/\b(\d+)\s+life\b/i);
  const lifeAmount = lifeMatch ? Math.max(0, Math.floor(Number(lifeMatch[1] || 0))) : 0;

  if (!manaCost && lifeAmount <= 0) return null;

  const parsed: ReflexiveFixedPaymentWhenYouDo = { paymentText, followupText };
  if (manaCost) parsed.manaCost = manaCost;
  if (lifeAmount > 0) parsed.lifeAmount = lifeAmount;
  return parsed;
}


export function parseReflexiveExileToOwnersGraveyardWhenYouDo(
  effectText: string,
): ReflexiveExileToOwnersGraveyardWhenYouDo | null {
  const normalized = normalizeReflexiveEffectText(effectText);
  if (!normalized) return null;

  const match = normalized.match(
    /^(?:you\s+may\s+)?put\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\s+(an\s+opponent\s+owns|your\s+opponents\s+own)\s+from\s+exile\s+into\s+(?:that\s+player'?s\s+graveyard|their\s+owners'?\s+graveyards)\.\s*(?:if|when)\s+you\s+do,?\s*([\s\S]+)$/i,
  );
  if (!match) return null;

  const rawCount = String(match[1] || '').trim().toLowerCase();
  const putCount = /^\d+$/.test(rawCount)
    ? Math.max(0, Math.floor(Number(rawCount)))
    : Math.max(0, Math.floor(Number(REFLEXIVE_NUMBER_WORDS[rawCount] || 0)));
  const ownerScopeRaw = String(match[2] || '').toLowerCase();
  const ownerScope: 'opponent' | 'opponents' = /opponents/.test(ownerScopeRaw) ? 'opponents' : 'opponent';
  const followupText = String(match[3] || '').trim();
  if (putCount <= 0 || !followupText) return null;

  return { putCount, ownerScope, followupText };
}

export function formatReflexiveExileToOwnersGraveyardLabel(putCount: number): string {
  const count = Math.max(1, Math.floor(Number(putCount || 1)));
  if (count === 1) return "a card an opponent owns from exile into that player's graveyard";
  return `${count} cards your opponents own from exile into their owners' graveyards`;
}

export function collectOpponentOwnedExileCardTargets(
  state: any,
  controllerId: string,
): Array<{ id: string; name: string; typeLine: string; manaCost: string; imageUrl?: string; zoneOwnerId: string; ownerId: string }> {
  const controller = String(controllerId || '').trim();
  const zones = (state?.zones || {}) as Record<string, any>;
  const players = Array.isArray(state?.players) ? state.players : [];
  const out: Array<{ id: string; name: string; typeLine: string; manaCost: string; imageUrl?: string; zoneOwnerId: string; ownerId: string }> = [];
  const seen = new Set<string>();

  const consider = (zonePlayerId: string, card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId || seen.has(cardId)) return;
    const ownerId = String(card?.owner || card?.ownerId || zonePlayerId || '').trim() || zonePlayerId;
    if (!ownerId || ownerId === controller) return;
    seen.add(cardId);
    out.push({
      id: cardId,
      name: String(card?.name || cardId),
      typeLine: String(card?.type_line || ''),
      manaCost: String(card?.mana_cost || ''),
      imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
      zoneOwnerId: String(zonePlayerId),
      ownerId,
    });
  };

  for (const player of players) {
    const pid = String(player?.id || '').trim();
    if (!pid) continue;
    const exile = Array.isArray(zones[pid]?.exile) ? zones[pid].exile : [];
    for (const card of exile) consider(pid, card);
  }

  for (const [pid, entry] of Object.entries(zones)) {
    if (players.some((p: any) => String(p?.id || '') === pid)) continue;
    const exile = Array.isArray((entry as any)?.exile) ? (entry as any).exile : [];
    for (const card of exile) consider(pid, card);
  }

  return out;
}

export function parseReflexiveSacrificeWhenYouDo(effectText: string): ReflexiveSacrificeWhenYouDo | null {
  const normalized = String(effectText || '')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(/^(?:you\s+may\s+)?sacrifice\s+((?:(?:a|an|another)\s+)?(?:nonland\s+|nontoken\s+)?(?:artifact|creature|enchantment|land|permanent)(?:\s+or\s+(?:artifact|creature|enchantment|land|permanent))?)\.\s*(?:when|if)\s+you\s+do,?\s*([\s\S]+)$/i);
  if (!match) return null;

  const sacrificeType = String(match[1] || '')
    .replace(/^(?:a|an)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const followupText = String(match[2] || '').trim();
  if (!sacrificeType || !followupText) return null;

  return { sacrificeType, followupText };
}

export function parseReflexiveDiscardWhenYouDo(effectText: string): ReflexiveDiscardWhenYouDo | null {
  const normalized = normalizeReflexiveEffectText(effectText);
  if (!normalized) return null;

  const match = normalized.match(/^(?:you\s+may\s+)?discard\s+(?:a|one|1)\s+card.\s*(?:when|if)\s+you\s+(?:do|discard\s+an?\s+([a-z][a-z -]*?)\s+card\s+this\s+way),?\s*([\s\S]+)$/i);
  if (!match) return null;

  const followupText = String(match[2] || '').trim();
  if (!followupText) return null;

  const typeFilter = String(match[1] || '').trim().toLowerCase();
  return { discardCount: 1, followupText, ...(typeFilter ? { typeFilter } : {}) };
}

export function parseReflexiveConvertWhenYouDo(effectText: string): ReflexiveConvertWhenYouDo | null {
  const normalized = String(effectText || '')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(/^(you\s+may\s+)?convert\s+(.+?).\s*(?:when|if)\s+you\s+do,?\s*([\s\S]+)$/i);
  if (!match) return null;

  const subjectText = String(match[2] || '').replace(/\s+/g, ' ').trim();
  const followupText = String(match[3] || '').trim();
  if (!subjectText || !followupText) return null;

  return {
    subjectText,
    isMayAbility: Boolean(match[1]),
    followupText,
  };
}

export function parseReflexiveGraveyardExileWhenYouDo(effectText: string): ReflexiveGraveyardExileWhenYouDo | null {
  const normalized = String(effectText || '')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const typePattern = '(?:nonland|noncreature|legendary|artifact|creature|enchantment|land|instant|sorcery|planeswalker)(?:\\s+or\\s+(?:artifact|creature|enchantment|land|instant|sorcery|planeswalker))?';
  const match = normalized.match(new RegExp(`^(?:you\\s+may\\s+)?exile\\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)\\s+(?:(` + typePattern + `)\\s+)?cards?\\s+from\\s+your\\s+graveyard\\.\\s*(?:when|if)\\s+you\\s+do,?\\s*([\\s\\S]+)$`, 'i'));
  if (!match) return null;

  const rawCount = String(match[1] || '').trim().toLowerCase();
  const exileCount = /^\d+$/.test(rawCount)
    ? Math.max(0, Math.floor(Number(rawCount)))
    : Math.max(0, Math.floor(Number(REFLEXIVE_NUMBER_WORDS[rawCount] || 0)));
  const cardType = String(match[2] || '').replace(/\s+/g, ' ').trim().toLowerCase() || undefined;
  const followupText = String(match[3] || '').trim();
  if (exileCount <= 0 || !followupText) return null;

  return { exileCount, ...(cardType ? { cardType } : null), followupText };
}

export function parseReflexiveBoundGraveyardSelfExileWhenYouDo(effectText: string): ReflexiveBoundGraveyardSelfExileWhenYouDo | null {
  const normalized = String(effectText || '')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(/^(?:(.*?)\.\s*then\s+)?you\s+may\s+exile\s+(it|this\s+card)\.\s*(when|if)\s+you\s+do,?\s*([\s\S]+)$/i);
  if (!match) return null;

  const preludeText = String(match[1] || '').replace(/\s+/g, ' ').trim();
  const selfReference = String(match[2] || '').replace(/\s+/g, ' ').trim().toLowerCase() as 'it' | 'this card';
  const followupConnector = String(match[3] || '').trim().toLowerCase() as 'when' | 'if';
  const followupText = String(match[4] || '').trim();
  if ((selfReference !== 'it' && selfReference !== 'this card') || !followupText) return null;
  if (followupConnector !== 'when' && followupConnector !== 'if') return null;

  return { selfReference, followupConnector, ...(preludeText ? { preludeText } : null), followupText };
}

export function parseReflexiveConditionalBattlefieldSelfExileWhenYouDo(effectText: string): ReflexiveConditionalBattlefieldSelfExileWhenYouDo | null {
  const normalized = String(effectText || '')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(/^(.*?)\.\s*then\s+if\s+this\s+(creature|enchantment|artifact|permanent|planeswalker)\s+has\s+no\s+([a-z0-9/+\- ]+?)\s+counters?\s+on\s+it,\s*exile\s+it\.\s*when\s+you\s+do,?\s*([\s\S]+)$/i);
  if (!match) return null;

  const preludeText = String(match[1] || '').replace(/\s+/g, ' ').trim();
  const selfReferenceType = String(match[2] || '').trim().toLowerCase();
  const conditionCounterType = String(match[3] || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const followupText = String(match[4] || '').trim();
  if (!preludeText || !selfReferenceType || !conditionCounterType || !followupText) return null;

  return { preludeText, selfReferenceType, conditionCounterType, followupText };
}

export function materializeReflexiveSourceText(followupText: string, sourceName: string): string {
  const source = String(sourceName || 'This source').trim() || 'This source';
  let text = String(followupText || '')
    .replace(/[’]/g, "'")
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

export function formatReflexiveSacrificeTypeLabel(sacrificeType: string): string {
  const normalizedType = String(sacrificeType || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedType) return 'a permanent';
  if (/^(?:a|an|another)\b/i.test(normalizedType)) return normalizedType;

  const article = /^[aeiou]/i.test(normalizedType) ? 'an' : 'a';
  return `${article} ${normalizedType}`;
}

export function formatReflexiveGraveyardExileLabel(exileCount: number, cardType?: string): string {
  const count = Math.max(1, Math.floor(Number(exileCount || 1)));
  const normalizedType = String(cardType || '').replace(/\s+/g, ' ').trim();
  const typePrefix = normalizedType ? `${normalizedType} ` : '';
  if (count === 1) {
    const article = normalizedType && /^[aeiou]/i.test(normalizedType) ? 'an' : 'a';
    return `${article} ${typePrefix}card`;
  }

  return `${count} ${typePrefix}cards`;
}

export function cardMatchesReflexiveGraveyardExileType(card: any, cardType?: string): boolean {
  const normalizedType = String(cardType || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalizedType) return true;

  const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
  if (normalizedType === 'nonland') return !typeLine.includes('land');
  if (normalizedType === 'noncreature') return !typeLine.includes('creature');

  const options = normalizedType.split(/\s+or\s+/).map((entry) => entry.trim()).filter(Boolean);
  return options.some((typeName) => typeLine.includes(typeName));
}

export function formatReflexiveFixedPaymentLabel(payment: Pick<ReflexiveFixedPaymentWhenYouDo, 'paymentText' | 'manaCost' | 'lifeAmount'>): string {
  const parts: string[] = [];
  const manaCost = String(payment?.manaCost || '').trim();
  const lifeAmount = Math.max(0, Math.floor(Number(payment?.lifeAmount || 0)));
  if (manaCost) parts.push(manaCost);
  if (lifeAmount > 0) parts.push(`${lifeAmount} life`);
  if (parts.length > 0) return parts.join(' and ');
  return String(payment?.paymentText || '').trim() || 'the cost';
}

export function permanentMatchesReflexiveSacrificeType(
  permanent: any,
  controllerId: string,
  sacrificeType: string,
  sourcePermanentId?: string,
): boolean {
  if (!permanent || String(permanent.controller || '') !== String(controllerId || '')) return false;

  const normalizedType = String(sacrificeType || '')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalizedType) return false;

  const permanentId = String(permanent.id || '').trim();
  if (/^another\b/.test(normalizedType) && sourcePermanentId && permanentId === String(sourcePermanentId)) {
    return false;
  }

  const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
  if (normalizedType.includes('nontoken') && permanent?.isToken === true) return false;
  if (normalizedType.includes('nonland') && typeLine.includes('land')) return false;

  const cleaned = normalizedType
    .replace(/^another\s+/, '')
    .replace(/^nontoken\s+/, '')
    .replace(/^nonland\s+/, '')
    .trim();

  if (cleaned === 'permanent') return true;

  const typeOptions = cleaned.split(/\s+or\s+/).map((entry) => entry.trim()).filter(Boolean);
  return typeOptions.some((typeName) => typeLine.includes(typeName));
}

export function formatReflexiveManaAmount(amount: number, paymentUnit: ReflexiveManaPaymentUnit): string {
  const normalizedAmount = Math.max(0, Math.floor(Number(amount || 0)));
  if (paymentUnit === 'mana') {
    return `${normalizedAmount} mana`;
  }
  if (isRepeatCostPaymentUnit(paymentUnit)) {
    return `${paymentUnit} ${normalizedAmount} time${normalizedAmount === 1 ? '' : 's'}`;
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
  if (isRepeatCostPaymentUnit(paymentUnit)) return getMaxRepeatCostPaymentsFromPool(state, playerId, String(paymentUnit));
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
  if (isRepeatCostPaymentUnit(paymentUnit)) {
    consumeRepeatCostPaymentFromPool(state, playerId, String(paymentUnit), paymentAmount);
    return;
  }

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
    .replace(/[\s\S]*/, (t) => materializeThatManyCount(t, amount))
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