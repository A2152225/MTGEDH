/**
 * Casualty keyword ability (Rule 702.153)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.153. Casualty
 * 702.153a Casualty is a keyword that represents two abilities. The first is a static ability 
 * that functions while the spell with casualty is on the stack. The second is a triggered ability 
 * that functions while the spell with casualty is on the stack. Casualty N means "As an additional 
 * cost to cast this spell, you may sacrifice a creature with power N or greater," and "When you 
 * cast this spell, if a casualty cost was paid for it, copy it. If the spell has any targets, you 
 * may choose new targets for the copy."
 * 702.153b If a spell has multiple instances of casualty, each is paid separately and triggers 
 * based on the payments made for it, not any other instance of casualty.
 */

export interface CasualtyAbility {
  readonly type: 'casualty';
  readonly source: string;
  readonly casualtyValue: number; // Minimum power required
  readonly wasPaid: boolean;
  readonly sacrificedCreature?: string;
  readonly copyId?: string;
}

/**
 * Create a casualty ability
 * Rule 702.153a
 * @param source - The spell with casualty
 * @param casualtyValue - Minimum power of creature to sacrifice
 * @returns Casualty ability object
 */
export function casualty(source: string, casualtyValue: number): CasualtyAbility {
  return {
    type: 'casualty',
    source,
    casualtyValue,
    wasPaid: false,
  };
}

/**
 * Pay casualty cost by sacrificing a creature
 * Rule 702.153a - Additional cost
 * @param ability - Casualty ability
 * @param sacrificedCreature - ID of sacrificed creature
 * @param creaturePower - Power of sacrificed creature
 * @returns Updated ability or null if power insufficient
 */
export function payCasualty(
  ability: CasualtyAbility,
  sacrificedCreature: string,
  creaturePower: number
): CasualtyAbility | null {
  if (creaturePower < ability.casualtyValue) {
    return null;
  }
  
  return {
    ...ability,
    wasPaid: true,
    sacrificedCreature,
  };
}

/**
 * Trigger casualty to copy spell
 * Rule 702.153a - When you cast this spell, if casualty was paid, copy it
 * @param ability - Casualty ability
 * @param copyId - ID of the copy
 * @returns Updated ability
 */
export function triggerCasualty(ability: CasualtyAbility, copyId: string): CasualtyAbility {
  if (!ability.wasPaid) {
    return ability;
  }
  
  return {
    ...ability,
    copyId,
  };
}

/**
 * Check if casualty was paid
 * @param ability - Casualty ability
 * @returns True if paid
 */
export function wasCasualtyPaid(ability: CasualtyAbility): boolean {
  return ability.wasPaid;
}

/**
 * Get casualty value
 * @param ability - Casualty ability
 * @returns Minimum power required
 */
export function getCasualtyValue(ability: CasualtyAbility): number {
  return ability.casualtyValue;
}

/**
 * Multiple instances of casualty trigger separately
 * Rule 702.153b
 * @param abilities - Array of casualty abilities
 * @returns False - each triggers separately
 */
export function hasRedundantCasualty(abilities: readonly CasualtyAbility[]): boolean {
  return false; // Each instance is paid and triggers separately
}
