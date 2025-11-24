/**
 * Infinity (∞) keyword ability (Rule 702.186)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.186. ∞ (Infinity)
 * 702.186a ∞ (the mathematical symbol for infinity) is a keyword found on Infinity cards. "∞" is 
 * followed by ability text. Together, they represent a static ability.
 * 702.186b "∞ — [Ability]" means "As long as this permanent is harnessed, it has [ability]."
 */

export interface InfinityAbility {
  readonly type: 'infinity';
  readonly source: string;
  readonly grantedAbility: string;
  readonly isHarnessed: boolean;
}

/**
 * Create an infinity ability
 * Rule 702.186a
 * @param source - The Infinity card
 * @param grantedAbility - Ability granted when harnessed
 * @returns Infinity ability object
 */
export function infinity(source: string, grantedAbility: string): InfinityAbility {
  return {
    type: 'infinity',
    source,
    grantedAbility,
    isHarnessed: false,
  };
}

/**
 * Harness the Infinity card
 * @param ability - Infinity ability
 * @returns Updated ability
 */
export function harnessInfinity(ability: InfinityAbility): InfinityAbility {
  return {
    ...ability,
    isHarnessed: true,
  };
}

/**
 * Unharness the Infinity card
 * @param ability - Infinity ability
 * @returns Updated ability
 */
export function unharnessInfinity(ability: InfinityAbility): InfinityAbility {
  return {
    ...ability,
    isHarnessed: false,
  };
}

/**
 * Check if ability is active
 * Rule 702.186b - Active when harnessed
 * @param ability - Infinity ability
 * @returns True if ability is active
 */
export function isInfinityActive(ability: InfinityAbility): boolean {
  return ability.isHarnessed;
}

/**
 * Get granted ability
 * @param ability - Infinity ability
 * @returns Granted ability text
 */
export function getInfinityAbility(ability: InfinityAbility): string {
  return ability.grantedAbility;
}

/**
 * Multiple instances of infinity are not redundant
 * @param abilities - Array of infinity abilities
 * @returns False
 */
export function hasRedundantInfinity(abilities: readonly InfinityAbility[]): boolean {
  return false;
}
