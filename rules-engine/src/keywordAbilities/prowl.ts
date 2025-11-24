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
  return creatureTypes.some(type => damageDealtByTypes.includes(type));
}

/**
 * Check if two prowl abilities are redundant
 * Multiple instances with different costs are not redundant
 */
export function areProwlAbilitiesRedundant(a: ProwlAbility, b: ProwlAbility): boolean {
  return a.cost === b.cost;
}
