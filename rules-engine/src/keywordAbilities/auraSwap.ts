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

export interface AuraSwapResult {
  readonly returnedAuraId: string;
  readonly putOntoBattlefieldAuraId: string;
  readonly exchangePerformed: boolean;
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

export function isAuraCard(typeLine: string): boolean {
  return typeLine.toLowerCase().includes('aura');
}

export function canActivateAuraSwap(
  isOnBattlefield: boolean,
  isAttachedAura: boolean,
  isControllerPriority: boolean = true
): boolean {
  return isOnBattlefield && isAttachedAura && isControllerPriority;
}

export function canExchangeWithHandAura(
  ability: AuraSwapAbility,
  handCardTypeLine: string
): boolean {
  return ability.type === 'auraSwap' && isAuraCard(handCardTypeLine);
}

export function performAuraSwap(
  battlefieldAuraId: string,
  handAuraId: string
): AuraSwapResult {
  return {
    returnedAuraId: battlefieldAuraId,
    putOntoBattlefieldAuraId: handAuraId,
    exchangePerformed: true,
  };
}
