/**
 * Prowl keyword ability (Rule 702.76)
 * @module keywordAbilities/prowl
 */

/**
 * Prowl ability (Rule 702.76)
 * Static ability allowing casting for alternative cost if combat damage was dealt
 */
export interface ProwlAbility {
  readonly type: 'prowl';
  readonly source: string;
  readonly cost: string;
  readonly wasPaid: boolean;
}

/**
 * Create a prowl ability
 * Rule 702.76a: "Prowl [cost]" means "You may pay [cost] rather than pay this
 * spell's mana cost if a player was dealt combat damage this turn by a source that,
 * at the time it dealt that damage, was under your control and had any of this
 * spell's creature types."
 */
export function prowl(source: string, cost: string): ProwlAbility {
  return {
    type: 'prowl',
    source,
    cost,
    wasPaid: false
  };
}

/**
 * Pay prowl cost
 */
export function payProwl(ability: ProwlAbility): ProwlAbility {
  return {
    ...ability,
    wasPaid: true
  };
}

/**
 * Check if prowl cost was paid
 */
export function wasProwled(ability: ProwlAbility): boolean {
  return ability.wasPaid;
}

/**
 * Check if prowl is available
 * Requires combat damage dealt by matching creature type
 */
export function isProwlAvailable(
  ability: ProwlAbility,
  creatureTypes: readonly string[],
  damageDealtByTypes: readonly string[]
): boolean {
  const normalizedDamageTypes = damageDealtByTypes.map(type => type.trim().toLowerCase());
  return creatureTypes.some(type => normalizedDamageTypes.includes(type.trim().toLowerCase()));
}

/**
 * Check whether a spell can be cast for its prowl cost.
 *
 * @param ability - The prowl ability
 * @param zone - The card's current zone
 * @param creatureTypes - Creature types on the spell
 * @param damageDealtByTypes - Types of creatures that dealt combat damage this turn
 * @returns True if the spell can be cast for its prowl cost
 */
export function canCastWithProwl(
  ability: ProwlAbility,
  zone: string,
  creatureTypes: readonly string[],
  damageDealtByTypes: readonly string[]
): boolean {
  return zone === 'hand' && isProwlAvailable(ability, creatureTypes, damageDealtByTypes);
}

/**
 * Creates the cast result for a spell cast via prowl.
 *
 * @param ability - The prowl ability
 * @param zone - The card's current zone
 * @param creatureTypes - Creature types on the spell
 * @param damageDealtByTypes - Types of creatures that dealt combat damage this turn
 * @returns Cast summary, or null if prowl cannot be used
 */
export function createProwlCastResult(
  ability: ProwlAbility,
  zone: string,
  creatureTypes: readonly string[],
  damageDealtByTypes: readonly string[]
): {
  source: string;
  fromZone: 'hand';
  alternativeCostPaid: string;
  usedProwl: true;
} | null {
  if (!canCastWithProwl(ability, zone, creatureTypes, damageDealtByTypes)) {
    return null;
  }

  return {
    source: ability.source,
    fromZone: 'hand',
    alternativeCostPaid: ability.cost,
    usedProwl: true,
  };
}

/**
 * Check if two prowl abilities are redundant
 * Multiple instances with different costs are not redundant
 */
export function areProwlAbilitiesRedundant(a: ProwlAbility, b: ProwlAbility): boolean {
  return a.cost === b.cost;
}
