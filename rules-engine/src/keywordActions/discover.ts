/**
 * Rule 701.57: Discover
 * 
 * "Discover N" means "Exile cards from the top of your library until you exile a
 * nonland card with mana value N or less. You may cast that card without paying
 * its mana cost if the resulting spell's mana value is less than or equal to N.
 * If you don't cast it, put that card into your hand. Put the remaining exiled
 * cards on the bottom of your library in a random order."
 * 
 * Reference: Rule 701.57
 */

export interface DiscoverAction {
  readonly type: 'discover';
  readonly playerId: string;
  readonly n: number;
  readonly discoveredCardId?: string;
  readonly wasCast?: boolean;
  readonly exiledCardIds?: readonly string[];
}

type DiscoverCardLike = {
  readonly id: string;
  readonly manaValue?: number;
  readonly mana_value?: number;
  readonly cmc?: number;
  readonly type_line?: string;
  readonly card?: {
    readonly manaValue?: number;
    readonly mana_value?: number;
    readonly cmc?: number;
    readonly type_line?: string;
  };
};

function getDiscoverManaValue(card: DiscoverCardLike): number {
  const candidates = [card.manaValue, card.mana_value, card.cmc, card.card?.manaValue, card.card?.mana_value, card.card?.cmc];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return 0;
}

function isLandCard(card: DiscoverCardLike): boolean {
  const typeLine = String(card.type_line || card.card?.type_line || '').toLowerCase();
  return typeLine.includes('land');
}

/**
 * Rule 701.57a: Discover N
 */
export function discover(playerId: string, n: number): DiscoverAction {
  return {
    type: 'discover',
    playerId,
    n,
  };
}

/**
 * Complete discover
 */
export function completeDiscover(
  playerId: string,
  n: number,
  discoveredCardId: string,
  wasCast: boolean,
  exiledCardIds: readonly string[]
): DiscoverAction {
  return {
    type: 'discover',
    playerId,
    n,
    discoveredCardId,
    wasCast,
    exiledCardIds,
  };
}

/**
 * Rule 701.57b: Discovered even if impossible
 */
export const DISCOVERED_EVEN_IF_IMPOSSIBLE = true;

/**
 * Rule 701.57c: Discovered card definition
 */
export function isDiscoveredCard(
  cardManaValue: number,
  n: number
): boolean {
  return cardManaValue <= n;
}

/**
 * Check whether a specific card qualifies as the discover hit.
 */
export function isDiscoverHit(card: DiscoverCardLike, n: number): boolean {
  return !isLandCard(card) && isDiscoveredCard(getDiscoverManaValue(card), n);
}

/**
 * Find the first discover hit among the exiled cards.
 */
export function findDiscoveredCard(cards: readonly DiscoverCardLike[], n: number): DiscoverCardLike | null {
  return cards.find((card) => isDiscoverHit(card, n)) || null;
}

/**
 * Check whether the discovered card may be cast for free.
 */
export function canCastDiscoveredCard(card: DiscoverCardLike, n: number): boolean {
  return isDiscoverHit(card, n);
}

/**
 * Get the non-hit cards that go to the bottom after discover resolves.
 */
export function getDiscoverBottomedCards(
  exiledCards: readonly DiscoverCardLike[],
  discoveredCardId: string,
): readonly DiscoverCardLike[] {
  return exiledCards.filter((card) => card.id !== discoveredCardId);
}
