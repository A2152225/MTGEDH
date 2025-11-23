/**
 * Deathtouch - Rule 702.2
 * 
 * A creature with toughness greater than 0 that's been dealt damage by a source with
 * deathtouch since the last time state-based actions were checked is destroyed.
 */

/**
 * Represents the deathtouch keyword ability
 * Rule 702.2
 */
export interface DeathtouchAbility {
  readonly type: 'deathtouch';
  readonly source: string; // ID of the object with deathtouch
}

/**
 * Create a deathtouch ability
 * Rule 702.2a - Deathtouch is a static ability
 * 
 * @param source - ID of the object with deathtouch
 * @returns Deathtouch ability
 */
export function deathtouch(source: string): DeathtouchAbility {
  return {
    type: 'deathtouch',
    source,
  };
}

/**
 * Check if damage from a source with deathtouch should destroy a creature
 * Rule 702.2b - A creature with toughness greater than 0 that's been dealt damage
 * by a source with deathtouch since the last time state-based actions were checked
 * is destroyed as a state-based action
 * 
 * @param creatureToughness - Current toughness of the creature
 * @param damageMarked - Damage marked on the creature from deathtouch source
 * @returns true if creature should be destroyed
 */
export function shouldDestroyFromDeathtouch(
  creatureToughness: number,
  damageMarked: number
): boolean {
  return creatureToughness > 0 && damageMarked > 0;
}

/**
 * Determine if any amount of damage is lethal when dealing with deathtouch
 * Rule 702.2c - Any nonzero amount of combat damage assigned to a creature by a
 * source with deathtouch is considered to be lethal damage
 * 
 * @param damage - Amount of damage being dealt
 * @param hasDeathtouch - Whether the source has deathtouch
 * @returns true if damage is lethal
 */
export function isLethalDamageWithDeathtouch(
  damage: number,
  hasDeathtouch: boolean
): boolean {
  if (!hasDeathtouch) {
    return false;
  }
  return damage > 0;
}

/**
 * Validate that deathtouch can be applied
 * Rule 702.2f - Multiple instances of deathtouch on the same object are redundant
 * 
 * @param existingAbilities - Array of deathtouch abilities already on the object
 * @returns true if deathtouch can be added (returns true even if redundant)
 */
export function canHaveDeathtouch(existingAbilities: readonly DeathtouchAbility[]): boolean {
  // Always returns true as multiple instances are just redundant, not invalid
  return true;
}

/**
 * Check if multiple deathtouch abilities are redundant
 * Rule 702.2f
 * 
 * @param abilities - Array of deathtouch abilities
 * @returns true if there are redundant instances
 */
export function hasRedundantDeathtouch(abilities: readonly DeathtouchAbility[]): boolean {
  return abilities.length > 1;
}
