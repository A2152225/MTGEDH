/**
 * Soulbond keyword ability implementation
 * Rule 702.95 - "Soulbond" means creatures can be paired for mutual benefits
 */

/**
 * Soulbond ability - Rule 702.95
 * Allows a creature to pair with another unpaired creature
 */
export interface SoulbondAbility {
  readonly type: 'soulbond';
  readonly source: string;
  readonly pairedWith?: string;
  readonly isPaired: boolean;
}

/**
 * Creates a soulbond ability
 * @param source - The creature with soulbond
 * @returns Soulbond ability
 */
export function soulbond(source: string): SoulbondAbility {
  return {
    type: 'soulbond',
    source,
    isPaired: false,
  };
}

/**
 * Pairs two creatures with soulbond
 * @param ability - The soulbond ability
 * @param target - The creature to pair with
 * @returns Updated soulbond ability
 */
export function pairCreatures(ability: SoulbondAbility, target: string): SoulbondAbility {
  if (ability.isPaired) {
    throw new Error('Creature is already paired');
  }
  return {
    ...ability,
    pairedWith: target,
    isPaired: true,
  };
}

/**
 * Unpairs creatures (when one leaves the battlefield)
 * @param ability - The soulbond ability
 * @returns Updated soulbond ability
 */
export function unpairCreatures(ability: SoulbondAbility): SoulbondAbility {
  return {
    ...ability,
    pairedWith: undefined,
    isPaired: false,
  };
}

/**
 * Checks if a creature can be paired
 * @param ability - The soulbond ability
 * @returns True if the creature can pair
 */
export function canPair(ability: SoulbondAbility): boolean {
  return !ability.isPaired;
}
