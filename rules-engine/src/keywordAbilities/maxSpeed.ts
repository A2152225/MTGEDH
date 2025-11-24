/**
 * Max Speed keyword ability (Rule 702.178)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.178. Max Speed
 * 702.178a A max speed ability is a special kind of static ability. "Max speed — [Ability]" means 
 * "As long as your speed is 4, this object has '[Ability].'"
 * 702.178b If an ability granted by a max speed ability states which zones it functions from, the 
 * max speed ability that grants that ability functions from those zones.
 */

export interface MaxSpeedAbility {
  readonly type: 'max-speed';
  readonly source: string;
  readonly grantedAbility: string;
  readonly playerSpeed: number;
}

/**
 * Create a max speed ability
 * Rule 702.178a
 * @param source - The object with max speed
 * @param grantedAbility - Ability granted at max speed
 * @returns Max speed ability object
 */
export function maxSpeed(source: string, grantedAbility: string): MaxSpeedAbility {
  return {
    type: 'max-speed',
    source,
    grantedAbility,
    playerSpeed: 0,
  };
}

/**
 * Update player speed
 * @param ability - Max speed ability
 * @param speed - Current player speed
 * @returns Updated ability
 */
export function updateSpeed(ability: MaxSpeedAbility, speed: number): MaxSpeedAbility {
  return {
    ...ability,
    playerSpeed: speed,
  };
}

/**
 * Check if ability is active
 * Rule 702.178a - Active when speed is 4
 * @param ability - Max speed ability
 * @returns True if ability is active
 */
export function isMaxSpeedActive(ability: MaxSpeedAbility): boolean {
  return ability.playerSpeed >= 4;
}

/**
 * Get granted ability
 * @param ability - Max speed ability
 * @returns Granted ability text
 */
export function getMaxSpeedAbility(ability: MaxSpeedAbility): string {
  return ability.grantedAbility;
}

/**
 * Multiple instances of max speed are not redundant
 * @param abilities - Array of max speed abilities
 * @returns False
 */
export function hasRedundantMaxSpeed(abilities: readonly MaxSpeedAbility[]): boolean {
  return false;
}
