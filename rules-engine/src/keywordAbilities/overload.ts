/**
 * Overload keyword ability implementation
 * Rule 702.96 - "Overload" means an alternative cost that changes "target" text to "each"
 */

/**
 * Overload ability - Rule 702.96
 * Allows paying an alternative cost to change targeting rules
 */
export interface OverloadAbility {
  readonly type: 'overload';
  readonly source: string;
  readonly overloadCost: string;
  readonly wasOverloaded: boolean;
}

/**
 * Creates an overload ability
 * @param source - The spell with overload
 * @param overloadCost - The overload cost
 * @returns Overload ability
 */
export function overload(source: string, overloadCost: string): OverloadAbility {
  return {
    type: 'overload',
    source,
    overloadCost,
    wasOverloaded: false,
  };
}

/**
 * Pays the overload cost
 * @param ability - The overload ability
 * @returns Updated overload ability
 */
export function payOverloadCost(ability: OverloadAbility): OverloadAbility {
  return {
    ...ability,
    wasOverloaded: true,
  };
}

/**
 * Checks if spell was overloaded
 * @param ability - The overload ability
 * @returns True if the spell was cast with overload
 */
export function isOverloaded(ability: OverloadAbility): boolean {
  return ability.wasOverloaded;
}
