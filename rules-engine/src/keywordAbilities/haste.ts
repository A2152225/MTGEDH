/**
 * Haste - Rule 702.10
 * 
 * A creature with haste can attack and use tap abilities immediately.
 */

/**
 * Represents the haste keyword ability
 * Rule 702.10
 */
export interface HasteAbility {
  readonly type: 'haste';
  readonly source: string; // ID of the object with haste
}

/**
 * Create a haste ability
 * Rule 702.10a - Haste is a static ability
 * 
 * @param source - ID of the object with haste
 * @returns Haste ability
 */
export function haste(source: string): HasteAbility {
  return {
    type: 'haste',
    source,
  };
}

/**
 * Check if a creature can attack despite summoning sickness
 * Rule 702.10b - If a creature has haste, it can attack even if it hasn't been controlled
 * by its controller continuously since their most recent turn began
 * 
 * @param hasHaste - Whether the creature has haste
 * @param underControlSinceTurnStart - Whether controlled since turn start
 * @returns true if the creature can attack
 */
export function canAttackWithHaste(
  hasHaste: boolean,
  underControlSinceTurnStart: boolean
): boolean {
  return hasHaste || underControlSinceTurnStart;
}

/**
 * Check if a creature can use tap/untap abilities despite summoning sickness
 * Rule 702.10c - If a creature has haste, its controller can activate its activated abilities
 * whose cost includes the tap symbol or untap symbol even if that creature hasn't been
 * controlled continuously since their most recent turn began
 * 
 * @param hasHaste - Whether the creature has haste
 * @param underControlSinceTurnStart - Whether controlled since turn start
 * @returns true if can activate tap/untap abilities
 */
export function canActivateTapAbilitiesWithHaste(
  hasHaste: boolean,
  underControlSinceTurnStart: boolean
): boolean {
  return hasHaste || underControlSinceTurnStart;
}

/**
 * Check if multiple haste abilities are redundant
 * Rule 702.10d - Multiple instances of haste on the same creature are redundant
 * 
 * @param abilities - Array of haste abilities
 * @returns true if there are redundant instances
 */
export function hasRedundantHaste(abilities: readonly HasteAbility[]): boolean {
  return abilities.length > 1;
}
