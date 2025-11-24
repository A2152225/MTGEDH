/**
 * Enlist keyword ability (Rule 702.154)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.154. Enlist
 * 702.154a Enlist represents a static ability and a triggered ability. Enlist means "As this 
 * creature attacks, you may tap up to one untapped creature you control that you didn't choose 
 * to attack with and that either has haste or has been under your control continuously since this 
 * turn began. When you do, this creature gets +X/+0 until end of turn, where X is the tapped 
 * creature's power."
 * 702.154b Enlist's static ability represents an optional cost to attack.
 * 702.154c A creature "enlists" another creature when you pay the cost of the creature's enlist 
 * ability by tapping the other creature. Note that it isn't possible for a creature to enlist 
 * itself.
 * 702.154d Multiple instances of enlist on a single creature function independently.
 */

export interface EnlistAbility {
  readonly type: 'enlist';
  readonly source: string;
  readonly enlistedCreature?: string;
  readonly powerBonus: number;
}

/**
 * Create an enlist ability
 * Rule 702.154a
 * @param source - The creature with enlist
 * @returns Enlist ability object
 */
export function enlist(source: string): EnlistAbility {
  return {
    type: 'enlist',
    source,
    powerBonus: 0,
  };
}

/**
 * Enlist another creature when attacking
 * Rule 702.154a - Tap untapped creature, get +X/+0
 * Rule 702.154c - "Enlists" another creature
 * @param ability - Enlist ability
 * @param enlistedCreature - ID of creature to tap
 * @param creaturePower - Power of enlisted creature
 * @returns Updated ability
 */
export function enlistCreature(
  ability: EnlistAbility,
  enlistedCreature: string,
  creaturePower: number
): EnlistAbility {
  return {
    ...ability,
    enlistedCreature,
    powerBonus: creaturePower,
  };
}

/**
 * Get power bonus from enlist
 * Rule 702.154a
 * @param ability - Enlist ability
 * @returns Power bonus
 */
export function getEnlistBonus(ability: EnlistAbility): number {
  return ability.powerBonus;
}

/**
 * Get enlisted creature
 * @param ability - Enlist ability
 * @returns ID of enlisted creature or undefined
 */
export function getEnlistedCreature(ability: EnlistAbility): string | undefined {
  return ability.enlistedCreature;
}

/**
 * Multiple instances of enlist function independently
 * Rule 702.154d
 * @param abilities - Array of enlist abilities
 * @returns False - each functions independently
 */
export function hasRedundantEnlist(abilities: readonly EnlistAbility[]): boolean {
  return false; // Each instance functions independently
}
