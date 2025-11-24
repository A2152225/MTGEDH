/**
 * Double Strike - Rule 702.4
 * 
 * A creature with double strike deals combat damage twice - once in the first combat
 * damage step with first strike creatures, and again in the second combat damage step.
 */

/**
 * Represents the double strike keyword ability
 * Rule 702.4
 */
export interface DoubleStrikeAbility {
  readonly type: 'doubleStrike';
  readonly source: string; // ID of the object with double strike
}

/**
 * Create a double strike ability
 * Rule 702.4a - Double strike is a static ability that modifies the rules for the combat damage step
 * 
 * @param source - ID of the object with double strike
 * @returns Double strike ability
 */
export function doubleStrike(source: string): DoubleStrikeAbility {
  return {
    type: 'doubleStrike',
    source,
  };
}

/**
 * Determine if a creature deals damage in the first combat damage step
 * Rule 702.4b - Creatures with double strike or first strike deal damage in first step
 * 
 * @param hasDoubleStrike - Whether the creature has double strike
 * @param hasFirstStrike - Whether the creature has first strike
 * @returns true if deals damage in first step
 */
export function dealsFirstStrikeDamage(
  hasDoubleStrike: boolean,
  hasFirstStrike: boolean
): boolean {
  return hasDoubleStrike || hasFirstStrike;
}

/**
 * Determine if a creature deals damage in the second combat damage step
 * Rule 702.4b - Creatures with double strike deal damage in both steps
 * 
 * @param hasDoubleStrike - Whether the creature has double strike
 * @param hasFirstStrike - Whether the creature has first strike
 * @param dealtFirstStrike - Whether it dealt damage in first strike step
 * @returns true if deals damage in second step
 */
export function dealsSecondStrikeDamage(
  hasDoubleStrike: boolean,
  hasFirstStrike: boolean,
  dealtFirstStrike: boolean
): boolean {
  // Deals damage in second step if it has double strike, or if it has neither ability
  if (hasDoubleStrike) {
    return true;
  }
  // If it has first strike but not double strike, it doesn't deal in second step
  if (hasFirstStrike && !hasDoubleStrike) {
    return false;
  }
  // If it dealt damage in first strike step but doesn't have double strike, it doesn't deal again
  if (dealtFirstStrike && !hasDoubleStrike) {
    return false;
  }
  // Normal creatures that didn't deal first strike damage deal in second step
  return !dealtFirstStrike;
}

/**
 * Check if removing double strike prevents second strike damage
 * Rule 702.4c - Removing double strike during first combat damage step stops assignment in second step
 * 
 * @param hadDoubleStrike - Whether creature had double strike before
 * @param hasDoubleStrike - Whether creature has double strike now
 * @param afterFirstStrike - Whether first combat damage step has occurred
 * @returns true if should not deal second strike damage
 */
export function preventsSecondStrike(
  hadDoubleStrike: boolean,
  hasDoubleStrike: boolean,
  afterFirstStrike: boolean
): boolean {
  return hadDoubleStrike && !hasDoubleStrike && afterFirstStrike;
}

/**
 * Check if multiple double strike abilities are redundant
 * Rule 702.4e - Multiple instances of double strike on the same creature are redundant
 * 
 * @param abilities - Array of double strike abilities
 * @returns true if there are redundant instances
 */
export function hasRedundantDoubleStrike(abilities: readonly DoubleStrikeAbility[]): boolean {
  return abilities.length > 1;
}
