/**
 * Lifelink - Rule 702.15
 * 
 * Damage dealt by a source with lifelink causes that source's controller to gain that much life.
 */

/**
 * Represents the lifelink keyword ability
 * Rule 702.15
 */
export interface LifelinkAbility {
  readonly type: 'lifelink';
  readonly source: string; // ID of the object with lifelink
}

/**
 * Create a lifelink ability
 * Rule 702.15a - Lifelink is a static ability
 * 
 * @param source - ID of the object with lifelink
 * @returns Lifelink ability
 */
export function lifelink(source: string): LifelinkAbility {
  return {
    type: 'lifelink',
    source,
  };
}

/**
 * Calculate life gain from damage dealt by a source with lifelink
 * Rule 702.15b - Damage dealt by a source with lifelink causes that source's controller,
 * or its owner if it has no controller, to gain that much life
 * 
 * @param damage - Amount of damage dealt
 * @param hasLifelink - Whether the source has lifelink
 * @returns Amount of life to gain
 */
export function calculateLifelinkGain(damage: number, hasLifelink: boolean): number {
  if (!hasLifelink || damage <= 0) {
    return 0;
  }
  return damage;
}

/**
 * Check if multiple lifelink abilities are redundant
 * Rule 702.15f - Multiple instances of lifelink on the same object are redundant
 * 
 * @param abilities - Array of lifelink abilities
 * @returns true if there are redundant instances
 */
export function hasRedundantLifelink(abilities: readonly LifelinkAbility[]): boolean {
  return abilities.length > 1;
}

/**
 * Determine if lifelink functions from all zones
 * Rule 702.15d - The lifelink rules function no matter what zone an object with lifelink deals damage from
 * 
 * @returns true (lifelink works from any zone)
 */
export function lifelinkFunctionsFromAllZones(): boolean {
  return true;
}
