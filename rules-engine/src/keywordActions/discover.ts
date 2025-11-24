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
