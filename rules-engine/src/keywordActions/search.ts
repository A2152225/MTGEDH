/**
 * Rule 701.23: Search
 * 
 * To search for a card in a zone, look at all cards in that zone and find a card
 * that matches the given description.
 * 
 * Reference: Rule 701.23
 */

export interface SearchAction {
  readonly type: 'search';
  readonly playerId: string;
  readonly zone: string;
  readonly zoneOwnerId?: string; // For searching another player's library/graveyard
  readonly criteria: SearchCriteria;
  readonly foundCardIds?: readonly string[];
  readonly revealFound?: boolean;
  readonly failToFind?: boolean; // Rule 701.23b
}

export interface SearchCriteria {
  readonly cardType?: string;
  readonly name?: string;
  readonly color?: string;
  readonly manaValue?: number;
  readonly maxResults?: number; // "up to X cards"
  readonly description?: string; // Full text description
}

/**
 * Rule 701.23a: Search a zone
 * 
 * To search for a card in a zone, look at all cards in that zone (even if it's
 * a hidden zone) and find a card that matches the given description.
 */
export function searchZone(
  playerId: string,
  zone: string,
  criteria: SearchCriteria,
  options: {
    zoneOwnerId?: string;
    revealFound?: boolean;
  } = {}
): SearchAction {
  return {
    type: 'search',
    playerId,
    zone,
    zoneOwnerId: options.zoneOwnerId,
    criteria,
    revealFound: options.revealFound,
  };
}

/**
 * Rule 701.23b: Fail to find
 * 
 * If a player is searching a hidden zone for cards with a stated quality, that
 * player isn't required to find some or all of those cards even if they're
 * present in that zone. This is called "failing to find."
 */
export function failToFind(action: SearchAction): SearchAction {
  return {
    ...action,
    failToFind: true,
    foundCardIds: [],
  };
}

/**
 * Rule 701.23c: Complete search
 * 
 * After the search is complete, the player shuffles that library (unless the
 * effect says otherwise).
 */
export function completeSearch(
  action: SearchAction,
  foundCardIds: readonly string[]
): SearchAction {
  return {
    ...action,
    foundCardIds,
  };
}

/**
 * Rule 701.23d: Can't search if zone is part of a merged permanent
 * 
 * If an effect would have a player search a zone that's part of a merged
 * permanent, that player searches the library of the permanent's controller instead.
 */
export function getSearchableZone(
  requestedZone: string,
  isMergedPermanent: boolean,
  controllerLibrary?: string
): string {
  if (isMergedPermanent && requestedZone === 'library') {
    return controllerLibrary || requestedZone;
  }
  return requestedZone;
}

/**
 * Rule 701.23e: Searching a public zone
 * 
 * If a player is searching a public zone, all players can see which cards are
 * found and which are not.
 */
export function isPublicZone(zone: string): boolean {
  const publicZones = ['battlefield', 'graveyard', 'exile', 'stack'];
  return publicZones.includes(zone);
}
