/**
 * Aura Swap keyword ability (Rule 702.65)
 * 
 * @module keywordAbilities/auraSwap
 */

/**
 * Represents an aura swap ability on an Aura permanent.
 * Rule 702.65: Aura swap is an activated ability of some Aura cards. "Aura swap [cost]" 
 * means "[Cost]: You may exchange this permanent with an Aura card in your hand."
 */
export interface AuraSwapAbility {
  readonly type: 'auraSwap';
  readonly cost: string;
  readonly source: string;
}

/**
 * Creates an aura swap ability.
 * 
 * @param source - The source Aura with aura swap
 * @param cost - The swap cost
 * @returns An aura swap ability
 * 
 * @example
 * ```typescript
 * const ability = auraSwap('Arcanum Wings', '{2}{U}');
 * ```
 */
export function auraSwap(source: string, cost: string): AuraSwapAbility {
  return {
    type: 'auraSwap',
    cost,
    source
  };
}
