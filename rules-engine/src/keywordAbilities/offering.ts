/**
 * Offering keyword ability implementation (Rule 702.48)
 * @see MagicCompRules 702.48
 */

export interface OfferingAbility {
  readonly type: 'offering';
  readonly offeringType: string;
  readonly source: string;
  readonly sacrificedCreature?: string;
}

export function offering(source: string, offeringType: string): OfferingAbility {
  return { type: 'offering', offeringType, source };
}

export function payOffering(ability: OfferingAbility, creature: string): OfferingAbility {
  return { ...ability, sacrificedCreature: creature };
}

export function getOfferingReduction(sacrificedMV: number): number {
  return sacrificedMV;
}

/**
 * Checks whether a spell can be cast using offering.
 *
 * @param ability - The offering ability
 * @param zone - The card's current zone
 * @param sacrificedCreature - The creature being sacrificed
 * @param sacrificedCreatureTypes - The sacrificed creature's types
 * @returns True if offering can be used
 */
export function canCastWithOffering(
  ability: OfferingAbility,
  zone: string,
  sacrificedCreature: string | undefined,
  sacrificedCreatureTypes: readonly string[]
): boolean {
  return zone === 'hand'
    && Boolean(sacrificedCreature)
    && sacrificedCreatureTypes.some(type => type.trim().toLowerCase() === ability.offeringType.trim().toLowerCase());
}

/**
 * Creates the cast result for a spell cast using offering.
 *
 * @param ability - The offering ability
 * @param zone - The card's current zone
 * @param sacrificedCreatureTypes - The sacrificed creature's types
 * @param sacrificedManaValue - The sacrificed creature's mana value
 * @returns Cast summary, or null if offering cannot be used
 */
export function createOfferingCastResult(
  ability: OfferingAbility,
  zone: string,
  sacrificedCreatureTypes: readonly string[],
  sacrificedManaValue: number
): {
  source: string;
  fromZone: 'hand';
  sacrificedCreature: string;
  reducedBy: number;
} | null {
  if (!canCastWithOffering(ability, zone, ability.sacrificedCreature, sacrificedCreatureTypes) || !ability.sacrificedCreature) {
    return null;
  }

  return {
    source: ability.source,
    fromZone: 'hand',
    sacrificedCreature: ability.sacrificedCreature,
    reducedBy: getOfferingReduction(sacrificedManaValue),
  };
}
