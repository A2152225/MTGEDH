/**
 * Trample - Rule 702.19
 * 
 * A creature with trample can deal excess combat damage to the player or planeswalker it's attacking.
 */

/**
 * Represents the trample keyword ability
 * Rule 702.19
 */
export interface TrampleAbility {
  readonly type: 'trample';
  readonly source: string; // ID of the object with trample
}

/**
 * Create a trample ability
 * Rule 702.19a - Trample is a static ability that modifies the rules for assigning
 * an attacking creature's combat damage
 * 
 * @param source - ID of the object with trample
 * @returns Trample ability
 */
export function trample(source: string): TrampleAbility {
  return {
    type: 'trample',
    source,
  };
}

/**
 * Calculate trample damage assignment
 * Rule 702.19b - The controller of an attacking creature with trample first assigns damage
 * to the creature(s) blocking it. Once all those blocking creatures are assigned lethal damage,
 * any excess damage is assigned as its controller chooses among those blocking creatures and
 * the player, planeswalker, or battle the creature is attacking
 * 
 * @param totalDamage - Total damage the attacker deals
 * @param blockerLethalDamage - Lethal damage needed for all blockers
 * @returns Object with blocker damage and excess damage
 */
export function calculateTrampleDamage(
  totalDamage: number,
  blockerLethalDamage: number
): { blockerDamage: number; excessDamage: number } {
  if (totalDamage <= blockerLethalDamage) {
    return {
      blockerDamage: totalDamage,
      excessDamage: 0,
    };
  }
  return {
    blockerDamage: blockerLethalDamage,
    excessDamage: totalDamage - blockerLethalDamage,
  };
}

/**
 * Check if a creature with trample can assign damage to defending player
 * Rule 702.19c - If an attacking creature with trample or trample over planeswalkers is
 * blocked, but there are no creatures blocking it when it assigns damage, its damage is
 * assigned to the player, planeswalker, or battle it's attacking
 * 
 * @param hasTrample - Whether the creature has trample
 * @param hasBlockers - Whether there are creatures blocking it
 * @returns true if damage goes to player
 */
export function assignsToPlayerWithNoBlockers(
  hasTrample: boolean,
  hasBlockers: boolean
): boolean {
  return hasTrample && !hasBlockers;
}

/**
 * Check if multiple trample abilities are redundant
 * Rule 702.19i - Multiple instances of trample on the same creature are redundant
 * 
 * @param abilities - Array of trample abilities
 * @returns true if there are redundant instances
 */
export function hasRedundantTrample(abilities: readonly TrampleAbility[]): boolean {
  return abilities.length > 1;
}
