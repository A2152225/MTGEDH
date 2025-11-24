/**
 * Kicker keyword ability implementation
 * Rule 702.33
 * 
 * Kicker is a static ability that functions while the spell with kicker is on the stack.
 */

/**
 * Kicker ability
 * Rule 702.33a
 * 
 * "Kicker [cost]" means "You may pay an additional [cost] as you cast this spell."
 * The phrase "Kicker [cost 1] and/or [cost 2]" means the same as
 * "Kicker [cost 1]" and "Kicker [cost 2]."
 */
export interface KickerAbility {
  readonly type: 'kicker';
  readonly cost: string;
  readonly source: string;
  readonly wasPaid: boolean;
}

/**
 * Creates a kicker ability
 * Rule 702.33a
 * 
 * @param source - The spell with kicker
 * @param cost - The kicker cost
 * @returns Kicker ability
 */
export function kicker(source: string, cost: string): KickerAbility {
  return {
    type: 'kicker',
    cost,
    source,
    wasPaid: false,
  };
}

/**
 * Pays a kicker cost
 * Rule 702.33a
 * 
 * @param ability - The kicker ability
 * @returns Updated ability with paid status
 */
export function payKicker(ability: KickerAbility): KickerAbility {
  return {
    ...ability,
    wasPaid: true,
  };
}

/**
 * Checks if spell was kicked
 * Rule 702.33b
 * 
 * @param ability - The kicker ability
 * @returns True if kicker cost was paid
 */
export function wasKicked(ability: KickerAbility): boolean {
  return ability.wasPaid;
}

/**
 * Multikicker variant
 * Rule 702.33c
 * 
 * "Multikicker [cost]" means "You may pay an additional [cost] any number of times
 * as you cast this spell."
 */
export interface MultikickerAbility {
  readonly type: 'multikicker';
  readonly cost: string;
  readonly source: string;
  readonly timesPaid: number;
}

/**
 * Creates a multikicker ability
 * Rule 702.33c
 * 
 * @param source - The spell with multikicker
 * @param cost - The multikicker cost
 * @returns Multikicker ability
 */
export function multikicker(source: string, cost: string): MultikickerAbility {
  return {
    type: 'multikicker',
    cost,
    source,
    timesPaid: 0,
  };
}

/**
 * Pays multikicker cost one or more times
 * Rule 702.33c
 * 
 * @param ability - The multikicker ability
 * @param times - Number of times to pay
 * @returns Updated ability with times paid
 */
export function payMultikicker(ability: MultikickerAbility, times: number): MultikickerAbility {
  return {
    ...ability,
    timesPaid: times,
  };
}

/**
 * Checks if multiple kicker abilities can coexist
 * Rule 702.33d - Objects with multiple kicker abilities can exist
 * 
 * @param abilities - Array of kicker abilities
 * @returns False (they are not redundant)
 */
export function hasRedundantKicker(abilities: readonly KickerAbility[]): boolean {
  return false; // Multiple kickers are intentional and not redundant
}
