/**
 * Offspring keyword ability (Rule 702.175)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.175. Offspring
 * 702.175a Offspring represents two abilities. "Offspring [cost]" means "You may pay an additional 
 * [cost] as you cast this spell" and "When this permanent enters, if its offspring cost was paid, 
 * create a token that's a copy of it, except it's 1/1."
 * 702.175b If a spell has multiple instances of offspring, each is paid separately and triggers 
 * based on the payments made for it, not any other instances of offspring.
 */

export interface OffspringAbility {
  readonly type: 'offspring';
  readonly source: string;
  readonly offspringCost: string;
  readonly wasPaid: boolean;
  readonly tokenId?: string;
}

/**
 * Create an offspring ability
 * Rule 702.175a
 * @param source - The spell with offspring
 * @param offspringCost - Additional cost
 * @returns Offspring ability object
 */
export function offspring(source: string, offspringCost: string): OffspringAbility {
  return {
    type: 'offspring',
    source,
    offspringCost,
    wasPaid: false,
  };
}

/**
 * Pay offspring cost when casting
 * Rule 702.175a - Additional cost
 * @param ability - Offspring ability
 * @returns Updated ability
 */
export function payOffspring(ability: OffspringAbility): OffspringAbility {
  return {
    ...ability,
    wasPaid: true,
  };
}

/**
 * Create offspring token when permanent enters
 * Rule 702.175a - 1/1 token copy
 * @param ability - Offspring ability
 * @param tokenId - ID of created token
 * @returns Updated ability
 */
export function createOffspringToken(ability: OffspringAbility, tokenId: string): OffspringAbility {
  return {
    ...ability,
    tokenId,
  };
}

/**
 * Check if offspring cost was paid
 * @param ability - Offspring ability
 * @returns True if paid
 */
export function wasOffspringPaid(ability: OffspringAbility): boolean {
  return ability.wasPaid;
}

/**
 * Multiple instances of offspring trigger separately
 * Rule 702.175b
 * @param abilities - Array of offspring abilities
 * @returns False - each paid and triggers separately
 */
export function hasRedundantOffspring(abilities: readonly OffspringAbility[]): boolean {
  return false; // Each is paid separately
}
