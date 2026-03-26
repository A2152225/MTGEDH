export interface ExpandedKeywordCostAbility {
  readonly type: 'keyword';
  readonly text: string;
  readonly cost: string;
  readonly effect: string;
}

function normalizeDashPunctuation(text: string): string {
  return String(text || '')
    .replace(/[\u2012\u2013\u2014\u2015]/g, '\u2014')
    .replace(/Ã¢â‚¬â€/g, '\u2014');
}

function stripTrailingReminder(text: string): string {
  return String(text || '')
    .replace(/\s+\([^()]*\)\s*$/, '')
    .trim();
}

function cleanCapturedCost(text: string): string {
  return stripTrailingReminder(text)
    .replace(/^(?:\u2014|-)\s*/, '')
    .trim();
}

function buildExpandedKeywordAbility(
  text: string,
  cost: string,
  effect: string
): ExpandedKeywordCostAbility {
  return {
    type: 'keyword',
    text,
    cost: cost.trim(),
    effect: effect.trim(),
  };
}

function formatCyclingSearchSelector(keyword: string): string | null {
  const raw = String(keyword || '').trim();
  if (!raw) return null;
  if (/^basic landcycling$/i.test(raw)) return 'basic land';

  const typecycling = raw.match(/^([A-Za-z]+)cycling$/i);
  if (!typecycling) return null;
  const selector = String(typecycling[1] || '').trim();
  return selector || null;
}

function indefiniteArticleFor(selector: string): 'a' | 'an' {
  return /^[aeiou]/i.test(String(selector || '').trim()) ? 'an' : 'a';
}

export function parseKeywordPrefixedActivatedAbility(text: string): ExpandedKeywordCostAbility | null {
  const normalized = normalizeDashPunctuation(text).trim();
  if (!normalized.includes(':')) return null;

  const directActivatedKeywords = ['boast', 'channel', 'exhaust', 'forecast'];
  for (const keyword of directActivatedKeywords) {
    const match = normalized.match(new RegExp(`^${keyword}\\s+(?:\\u2014\\s*)?(.+?):\\s*([\\s\\S]+)$`, 'i'));
    if (!match) continue;

    return buildExpandedKeywordAbility(
      text,
      cleanCapturedCost(String(match[1] || '')),
      String(match[2] || '').trim()
    );
  }

  return null;
}

export function expandKeywordCostAbility(
  text: string,
  keyword: string,
  rawCost: string
): ExpandedKeywordCostAbility | null {
  const normalizedKeyword = String(keyword || '').trim().toLowerCase();
  const cleanCost = cleanCapturedCost(normalizeDashPunctuation(rawCost));

  if (normalizedKeyword !== 'cycling' && normalizedKeyword.endsWith('cycling')) {
    const selector = formatCyclingSearchSelector(keyword);
    if (selector) {
      const article = indefiniteArticleFor(selector);
      return buildExpandedKeywordAbility(
        text,
        `${cleanCost}, Discard this card`,
        `Search your library for ${article} ${selector} card, reveal it, put it into your hand, then shuffle.`
      );
    }
  }

  switch (normalizedKeyword) {
    case 'adapt':
      return buildExpandedKeywordAbility(
        text,
        cleanCost,
        'If there are no +1/+1 counters on it, put 2 +1/+1 counters on this permanent. Activate only as a sorcery.'
          .replace(/\b2\b/, String(text.match(/adapt\s+(\d+|x)/i)?.[1] || '').toUpperCase())
      );
    case 'buyback':
      return buildExpandedKeywordAbility(
        text,
        cleanCost,
        'You may pay an additional buyback cost as you cast this spell. If the buyback cost was paid, put this spell into your hand instead of into your graveyard as it resolves.'
      );
    case 'cycling':
      return buildExpandedKeywordAbility(
        text,
        `${cleanCost}, Discard this card`,
        'Draw a card.'
      );
    case 'disturb':
      return buildExpandedKeywordAbility(
        text,
        cleanCost,
        'You may cast this card from your graveyard.'
      );
    case 'embalm':
      return buildExpandedKeywordAbility(
        text,
        `${cleanCost}, Exile this card from your graveyard`,
        "Create a token that's a copy of it, except it's white, it has no mana cost, and it's a Zombie in addition to its other types. Activate only as a sorcery."
      );
    case 'encore':
      return buildExpandedKeywordAbility(
        text,
        `${cleanCost}, Exile this card from your graveyard`,
        "For each opponent, create a token that's a copy of it. Those tokens enter tapped and attacking. They gain haste. Sacrifice them at the beginning of the next end step. Activate only as a sorcery."
      );
    case 'escape':
      return buildExpandedKeywordAbility(
        text,
        cleanCost,
        'You may cast this card from your graveyard for its escape cost.'
      );
    case 'eternalize':
      return buildExpandedKeywordAbility(
        text,
        `${cleanCost}, Exile this card from your graveyard`,
        "Create a token that's a copy of it, except it's black, it's 4/4, it has no mana cost, and it's a Zombie in addition to its other types. Activate only as a sorcery."
      );
    case 'equip':
      return buildExpandedKeywordAbility(
        text,
        cleanCost,
        'Attach this permanent to target creature you control. Activate only as a sorcery.'
      );
    case 'flashback':
      return buildExpandedKeywordAbility(
        text,
        cleanCost,
        'You may cast this card from your graveyard for its flashback cost. Then exile it.'
      );
    case 'fortify':
      return buildExpandedKeywordAbility(
        text,
        cleanCost,
        'Attach this permanent to target land you control. Activate only as a sorcery.'
      );
    case 'level up':
      return buildExpandedKeywordAbility(
        text,
        cleanCost,
        'Put a level counter on this permanent. Activate only as a sorcery.'
      );
    case 'jump-start':
      return buildExpandedKeywordAbility(
        text,
        cleanCost,
        'You may cast this card from your graveyard for its jump-start cost. Then exile it.'
      );
    case 'megamorph':
      return buildExpandedKeywordAbility(
        text,
        cleanCost,
        'Turn this permanent face up. Put a +1/+1 counter on it.'
      );
    case 'morph':
      return buildExpandedKeywordAbility(
        text,
        cleanCost,
        'Turn this permanent face up.'
      );
    case 'outlast':
      return buildExpandedKeywordAbility(
        text,
        `${cleanCost}, {T}`,
        'Put a +1/+1 counter on this creature. Activate only as a sorcery.'
      );
    case 'reinforce': {
      const reinforceMatch = cleanCost.match(/^(\d+|X)\s*[\u2014-]\s*(.+)$/i);
      if (!reinforceMatch) return null;
      const amountText = String(reinforceMatch[1] || '').trim();
      const manaCost = String(reinforceMatch[2] || '').trim();
      if (!amountText || !manaCost) return null;

      if (/^x$/i.test(amountText)) {
        return buildExpandedKeywordAbility(
          text,
          `${manaCost}, Discard this card`,
          'Put X +1/+1 counters on target creature.'
        );
      }

      const amount = Number.parseInt(amountText, 10);
      if (!Number.isFinite(amount) || amount <= 0) return null;
      const counterLabel = amount === 1 ? 'counter' : 'counters';
      return buildExpandedKeywordAbility(
        text,
        `${manaCost}, Discard this card`,
        `Put ${amount} +1/+1 ${counterLabel} on target creature.`
      );
    }
    case 'replicate':
      return buildExpandedKeywordAbility(
        text,
        cleanCost,
        'As an additional cost to cast this spell, you may pay its replicate cost any number of times. When you cast this spell, copy it for each time you paid its replicate cost. You may choose new targets for the copies.'
      );
    case 'scavenge':
      return buildExpandedKeywordAbility(
        text,
        `${cleanCost}, Exile this card from your graveyard`,
        "Put X +1/+1 counters on target creature, where X is this card's power. Activate only as a sorcery."
      );
    case 'transmute':
      return buildExpandedKeywordAbility(
        text,
        `${cleanCost}, Discard this card`,
        'Search your library for a card with the same mana value as this card, reveal it, put it into your hand, then shuffle. Activate only as a sorcery.'
      );
    case 'transfigure':
      return buildExpandedKeywordAbility(
        text,
        `${cleanCost}, Sacrifice this permanent`,
        'Search your library for a creature card with the same mana value as this permanent, put it onto the battlefield, then shuffle. Activate only as a sorcery.'
      );
    case 'unearth':
      return buildExpandedKeywordAbility(
        text,
        cleanCost,
        'Return this card from your graveyard to the battlefield. Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead of putting it anywhere else.'
      );
    case 'retrace':
      return buildExpandedKeywordAbility(
        text,
        cleanCost,
        'You may cast this card from your graveyard for its retrace cost.'
      );
    default:
      return null;
  }
}
