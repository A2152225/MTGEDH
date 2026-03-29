/**
 * Transmute keyword ability implementation (Rule 702.53)
 * @see MagicCompRules 702.53
 */

export interface TransmuteAbility {
  readonly type: 'transmute';
  readonly cost: string;
  readonly source: string;
  readonly wasActivated: boolean;
}

export function transmute(source: string, cost: string): TransmuteAbility {
  return { type: 'transmute', cost, source, wasActivated: false };
}

export function activateTransmute(ability: TransmuteAbility): TransmuteAbility {
  return { ...ability, wasActivated: true };
}

export function canTransmute(isInHand: boolean, canPlaySorcery: boolean): boolean {
  return isInHand && canPlaySorcery;
}

/**
 * Checks whether transmute can be activated from the given zone.
 *
 * @param ability - The transmute ability
 * @param zone - The card's current zone
 * @param canPlaySorcery - Whether sorcery timing is available
 * @returns True if transmute can be activated now
 */
export function canTransmuteFromZone(
  ability: TransmuteAbility,
  zone: string,
  canPlaySorcery: boolean
): boolean {
  return !ability.wasActivated && canTransmute(zone === 'hand', canPlaySorcery);
}

/**
 * Creates the search summary for transmute.
 *
 * @param ability - The transmute ability
 * @param zone - The card's current zone
 * @param canPlaySorcery - Whether sorcery timing is available
 * @param sourceManaValue - Mana value of the discarded card
 * @returns Search summary, or null if transmute cannot be activated now
 */
export function createTransmuteSearchResult(
  ability: TransmuteAbility,
  zone: string,
  canPlaySorcery: boolean,
  sourceManaValue: number
): {
  source: string;
  discardedCard: string;
  costPaid: string;
  searchesForManaValue: number;
} | null {
  if (!canTransmuteFromZone(ability, zone, canPlaySorcery)) {
    return null;
  }

  return {
    source: ability.source,
    discardedCard: ability.source,
    costPaid: ability.cost,
    searchesForManaValue: sourceManaValue,
  };
}
