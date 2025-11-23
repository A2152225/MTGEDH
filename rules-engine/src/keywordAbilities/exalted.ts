/**
 * Exalted keyword ability (Rule 702.83)
 * @module keywordAbilities/exalted
 */

/**
 * Exalted ability (Rule 702.83)
 * Triggered ability that gives bonus to creatures attacking alone
 */
export interface ExaltedAbility {
  readonly type: 'exalted';
  readonly source: string;
}

/**
 * Create an exalted ability
 * Rule 702.83a: "Exalted" means "Whenever a creature you control attacks alone,
 * that creature gets +1/+1 until end of turn."
 */
export function exalted(source: string): ExaltedAbility {
  return {
    type: 'exalted',
    source
  };
}

/**
 * Check if creature is attacking alone
 * Rule 702.83b: A creature "attacks alone" if it's the only creature declared
 * as an attacker in a given combat phase.
 */
export function isAttackingAlone(attackers: readonly string[]): boolean {
  return attackers.length === 1;
}

/**
 * Get exalted bonus
 * Each exalted trigger gives +1/+1
 */
export function getExaltedBonus(): { power: number; toughness: number } {
  return { power: 1, toughness: 1 };
}

/**
 * Check if two exalted abilities are redundant
 * Rule 702.83: Multiple instances trigger separately
 */
export function areExaltedAbilitiesRedundant(a: ExaltedAbility, b: ExaltedAbility): boolean {
  return false;
}
