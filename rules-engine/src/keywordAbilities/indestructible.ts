/**
 * Indestructible - Rule 702.12
 * 
 * A permanent with indestructible can't be destroyed.
 */

/**
 * Represents the indestructible keyword ability
 * Rule 702.12
 */
export interface IndestructibleAbility {
  readonly type: 'indestructible';
  readonly source: string; // ID of the object with indestructible
}

/**
 * Create an indestructible ability
 * Rule 702.12a - Indestructible is a static ability
 * 
 * @param source - ID of the object with indestructible
 * @returns Indestructible ability
 */
export function indestructible(source: string): IndestructibleAbility {
  return {
    type: 'indestructible',
    source,
  };
}

/**
 * Check if a permanent can be destroyed
 * Rule 702.12b - A permanent with indestructible can't be destroyed. Such permanents aren't
 * destroyed by lethal damage, and they ignore the state-based action that checks for lethal damage
 * 
 * @param hasIndestructible - Whether the permanent has indestructible
 * @returns true if the permanent can be destroyed
 */
export function canBeDestroyed(hasIndestructible: boolean): boolean {
  return !hasIndestructible;
}

/**
 * Check if lethal damage destroys a permanent with indestructible
 * Rule 702.12b - Indestructible permanents ignore lethal damage checks
 * 
 * @param hasIndestructible - Whether the permanent has indestructible
 * @param hasLethalDamage - Whether the permanent has lethal damage marked
 * @returns true if should be destroyed
 */
export function destroyedByLethalDamage(
  hasIndestructible: boolean,
  hasLethalDamage: boolean
): boolean {
  if (hasIndestructible) {
    return false;
  }
  return hasLethalDamage;
}

/**
 * Check if multiple indestructible abilities are redundant
 * Rule 702.12c - Multiple instances of indestructible on the same permanent are redundant
 * 
 * @param abilities - Array of indestructible abilities
 * @returns true if there are redundant instances
 */
export function hasRedundantIndestructible(abilities: readonly IndestructibleAbility[]): boolean {
  return abilities.length > 1;
}
