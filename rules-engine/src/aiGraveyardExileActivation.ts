/**
 * When "{2}: Exile target card from a graveyard" is worth activating.
 *
 * A single-card graveyard exile is a mana sink unless it does one of:
 * - setup: this permanent lets you cast or play a card you exile with it, and a
 *   matching card is in a graveyard now
 * - deny-recovery: an opponent can get a graveyard card back (the card casts
 *   itself from the graveyard, or they have a visible reanimation / graveyard-cast
 *   effect that hits it)
 *
 * Public entry symbols: isSingleCardGraveyardExileAbility,
 * classifySingleCardGraveyardExile, scoreGraveyardExileTarget.
 */

export type GraveyardExileActivationReason = 'none' | 'setup' | 'deny-recovery';

const SINGLE_CARD_GRAVEYARD_EXILE_RE = /exile target card from (?:a|target) graveyard/i;

const SELF_GRAVEYARD_USE_RE =
  /\b(?:flashback|escape|unearth|embalm|eternalize|disturb|encore|jump-start|aftermath|retrace|harmonize|scavenge|dredge)\b|\b(?:cast|play) (?:this card|it|~|[A-Z][\w'']*) from (?:your )?graveyard\b|\breturn (?:this card|it|~|[A-Z][\w'']*) from your graveyard\b|\bfrom your graveyard to (?:your hand|the battlefield)\b/i;

const EXILE_CAST_PERMISSION_RE =
  /you may (?:cast|play) ([^.]+?) from among cards (you own )?exiled with/gi;

const TYPE_WORDS = ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle', 'instant', 'sorcery', 'land', 'tribal', 'kindred'] as const;

export function isSingleCardGraveyardExileAbility(abilityText: string): boolean {
  return SINGLE_CARD_GRAVEYARD_EXILE_RE.test(String(abilityText || ''));
}

function cardRecord(entry: any): any {
  return entry?.card || entry;
}

function cardTypeLine(card: any): string {
  return String(card?.type_line || card?.typeLine || '').toLowerCase();
}

function cardOracle(card: any): string {
  const keywords = Array.isArray(card?.keywords) ? card.keywords.join('\n') : '';
  return `${keywords}\n${card?.oracle_text || card?.oracleText || ''}`;
}

function listNestedCards(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of ['cards', 'commanderCards', 'commanders', 'inCommandZone']) {
      if (Array.isArray(value[key]) && value[key].some((entry: any) => entry && typeof entry === 'object' && (entry.card || entry.oracle_text || entry.name))) {
        return value[key];
      }
    }
  }
  return [];
}

function eachGraveyardCard(gameState: any, visit: (card: any, ownerId: string) => void): void {
  const zones = gameState?.zones || {};
  for (const [ownerId, playerZones] of Object.entries(zones)) {
    const graveyard = Array.isArray((playerZones as any)?.graveyard) ? (playerZones as any).graveyard : [];
    for (const entry of graveyard) {
      const card = cardRecord(entry);
      if (card) visit(card, String(ownerId));
    }
  }
}

function qualifierMatchesCard(qualifier: string, card: any): boolean {
  const q = String(qualifier || '').toLowerCase();
  const typeLine = cardTypeLine(card);
  const isLand = typeLine.includes('land');
  if (/\bnonland\b/.test(q) && isLand) return false;
  if (/\bspells?\b/.test(q) && isLand && !/\blands?\b/.test(q)) return false;

  for (const word of TYPE_WORDS) {
    if (new RegExp(`\\b${word}s?\\b`).test(q) && !typeLine.includes(word)) return false;
  }

  const filler = new Set([
    'you', 'may', 'cast', 'play', 'spell', 'spells', 'card', 'cards', 'nonland',
    'from', 'among', 'a', 'an', 'the', 'target', 'and', 'or', 'with', 'this',
    'that', 'those', 'any', 'number', 'of',
  ]);
  for (const token of q.split(/[^a-z0-9+-]+/).filter(Boolean)) {
    if (filler.has(token)) continue;
    const singular = token.endsWith('s') ? token.slice(0, -1) : token;
    if ((TYPE_WORDS as readonly string[]).includes(token) || (TYPE_WORDS as readonly string[]).includes(singular)) continue;
    if (!typeLine.includes(token) && !typeLine.includes(singular)) return false;
  }
  return true;
}

function sourceHasExileCastSetup(sourceOracle: string, card: any, ownerId: string, playerId: string): boolean {
  const text = String(sourceOracle || '');
  EXILE_CAST_PERMISSION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXILE_CAST_PERMISSION_RE.exec(text)) !== null) {
    const youOwn = Boolean(match[2]);
    if (youOwn && ownerId !== playerId) continue;
    if (qualifierMatchesCard(match[1] || '', card)) return true;
  }
  return false;
}

function cardIsSelfRecoverable(card: any): boolean {
  return SELF_GRAVEYARD_USE_RE.test(cardOracle(card));
}

function cardFitsRecoveryText(text: string, card: any): boolean {
  const typeLine = cardTypeLine(card);
  const lower = text.toLowerCase();
  const mentioned = TYPE_WORDS.filter((word) => new RegExp(`\\b${word}s?\\b`).test(lower));
  const saysPermanent = /\bpermanents?\b/.test(lower);
  if (mentioned.length === 0 && !saysPermanent) return true;
  if (saysPermanent && !/\binstant\b/.test(typeLine) && !/\bsorcery\b/.test(typeLine)) return true;
  return mentioned.some((word) => typeLine.includes(word));
}

function sentenceRecoversCard(sentence: string, card: any, engineControllerIsCardOwner: boolean): boolean {
  const text = String(sentence || '').trim();
  if (!/graveyard/i.test(text)) return false;
  // "Exile target card from a graveyard" is hate, not a way to get the card back.
  if (/\bexile\b/i.test(text) && !/\b(?:return|cast|play|put)\b/i.test(text)) return false;
  const recovers = /\b(?:return|cast|play)\b/i.test(text)
    || /onto the battlefield/i.test(text)
    || /\benchant\b/i.test(text);
  if (!recovers) return false;
  const ownYardOnly = /\byour graveyard\b/i.test(text)
    && !/\b(?:a|each|any|their|target player's) graveyard\b/i.test(text);
  if (ownYardOnly && !engineControllerIsCardOwner) return false;
  return cardFitsRecoveryText(text, card);
}

function textRecoversCard(text: string, card: any, engineControllerIsCardOwner: boolean): boolean {
  return String(text || '')
    .split(/[.\n]/)
    .some((sentence) => sentenceRecoversCard(sentence, card, engineControllerIsCardOwner));
}

function visibleCardsForPlayer(gameState: any, playerId: string): any[] {
  const battlefield = Array.isArray(gameState?.battlefield) ? gameState.battlefield : [];
  const controlled = battlefield.filter((perm: any) => String(perm?.controller || '') === playerId);
  return [...controlled, ...listNestedCards(gameState?.commandZone?.[playerId])];
}

function opponentCanRecoverCard(gameState: any, playerId: string, card: any, ownerId: string): boolean {
  if (!ownerId || ownerId === playerId) return false;
  if (cardIsSelfRecoverable(card)) return true;

  const players = new Set<string>();
  for (const perm of Array.isArray(gameState?.battlefield) ? gameState.battlefield : []) {
    const controller = String(perm?.controller || '');
    if (controller && controller !== playerId) players.add(controller);
  }
  for (const key of Object.keys(gameState?.commandZone || {})) {
    if (key && key !== playerId) players.add(key);
  }
  players.add(ownerId);

  for (const enginePlayer of players) {
    if (enginePlayer === playerId) continue;
    for (const source of visibleCardsForPlayer(gameState, enginePlayer)) {
      const sourceCard = cardRecord(source);
      if (textRecoversCard(cardOracle(sourceCard), card, enginePlayer === ownerId)) return true;
    }
  }
  return false;
}

export function classifySingleCardGraveyardExile(
  gameState: any,
  playerId: string,
  permanent: any,
  abilityText: string,
): GraveyardExileActivationReason {
  if (!isSingleCardGraveyardExileAbility(abilityText)) return 'none';
  const pid = String(playerId || '');
  const sourceOracle = cardOracle(cardRecord(permanent));
  let setup = false;
  let deny = false;
  eachGraveyardCard(gameState, (card, ownerId) => {
    if (ownerId !== pid && opponentCanRecoverCard(gameState, pid, card, ownerId)) deny = true;
    if (sourceHasExileCastSetup(sourceOracle, card, ownerId, pid)) setup = true;
  });
  if (deny) return 'deny-recovery';
  if (setup) return 'setup';
  return 'none';
}

/** Higher is a better exile target. Non-payoff cards stay below anything recoverable. */
export function scoreGraveyardExileTarget(
  gameState: any,
  playerId: string,
  sourceCard: any,
  card: any,
  ownerId: string,
): number {
  const pid = String(playerId || '');
  const manaValue = Number(card?.cmc || card?.manaValue || 0) || 0;
  const sourceOracle = cardOracle(cardRecord(sourceCard));
  if (sourceHasExileCastSetup(sourceOracle, card, ownerId, pid)) {
    return 160 + manaValue;
  }
  if (ownerId !== pid && cardIsSelfRecoverable(card)) {
    return 180 + manaValue;
  }
  if (ownerId !== pid && opponentCanRecoverCard(gameState, pid, card, ownerId)) {
    const creatureBonus = cardTypeLine(card).includes('creature') ? 20 : 0;
    return 140 + creatureBonus + manaValue;
  }
  return ownerId === pid ? -40 : -20;
}
