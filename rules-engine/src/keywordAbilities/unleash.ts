/**
 * Unleash keyword ability implementation
 * Rule 702.98 - "Unleash" means creature enters with a +1/+1 counter but can't block
 */

/**
 * Unleash ability - Rule 702.98
 * Allows a creature to enter with a counter at the cost of not being able to block
 */
export interface UnleashAbility {
  readonly type: 'unleash';
  readonly source: string;
  readonly wasUnleashed: boolean;
}

/**
 * Creates an unleash ability
 * @param source - The creature with unleash
 * @returns Unleash ability
 */
export function unleash(source: string): UnleashAbility {
  return {
    type: 'unleash',
    source,
    wasUnleashed: false,
  };
}

/**
 * Chooses to unleash the creature
 * @param ability - The unleash ability
 * @returns Updated unleash ability
 */
export function chooseToUnleash(ability: UnleashAbility): UnleashAbility {
  return {
    ...ability,
    wasUnleashed: true,
  };
}

/**
 * Checks if creature was unleashed
 * @param ability - The unleash ability
 * @returns True if the creature was unleashed
 */
export function isUnleashed(ability: UnleashAbility): boolean {
  return ability.wasUnleashed;
}

/**
 * Checks if creature can block
 * @param ability - The unleash ability
 * @returns False if unleashed, true otherwise
 */
export function canBlock(ability: UnleashAbility): boolean {
  return !ability.wasUnleashed;
}
