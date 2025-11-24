/**
 * Fortify keyword ability (Rule 702.67)
 * 
 * @module keywordAbilities/fortify
 */

/**
 * Represents a fortify ability on a Fortification permanent.
 * Rule 702.67: Fortify is an activated ability of Fortification cards. "Fortify [cost]" 
 * means "[Cost]: Attach this Fortification to target land you control. Activate only 
 * as a sorcery."
 */
export interface FortifyAbility {
  readonly type: 'fortify';
  readonly cost: string;
  readonly source: string;
  readonly attachedTo?: string;
}

/**
 * Creates a fortify ability.
 * 
 * @param source - The source Fortification with fortify
 * @param cost - The fortify cost
 * @returns A fortify ability
 * 
 * @example
 * ```typescript
 * const ability = fortify('Darksteel Garrison', '{3}');
 * ```
 */
export function fortify(source: string, cost: string): FortifyAbility {
  return {
    type: 'fortify',
    cost,
    source
  };
}

/**
 * Attaches the fortification to a land.
 * 
 * @param ability - The fortify ability
 * @param landId - ID of the land to fortify
 * @returns Updated ability
 */
export function attachFortification(ability: FortifyAbility, landId: string): FortifyAbility {
  return {
    ...ability,
    attachedTo: landId
  };
}

/**
 * Detaches the fortification.
 * 
 * @param ability - The fortify ability
 * @returns Updated ability
 */
export function detachFortification(ability: FortifyAbility): FortifyAbility {
  return {
    ...ability,
    attachedTo: undefined
  };
}
