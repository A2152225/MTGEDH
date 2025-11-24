/**
 * Decayed keyword ability (Rule 702.147)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.147. Decayed
 * 702.147a Decayed represents a static ability and a triggered ability. "Decayed" means "This 
 * creature can't block" and "When this creature attacks, sacrifice it at end of combat."
 */

export interface DecayedAbility {
  readonly type: 'decayed';
  readonly source: string;
  readonly hasAttacked: boolean;
}

/**
 * Create a decayed ability
 * Rule 702.147a
 * @param source - The creature with decayed
 * @returns Decayed ability object
 */
export function decayed(source: string): DecayedAbility {
  return {
    type: 'decayed',
    source,
    hasAttacked: false,
  };
}

/**
 * Check if decayed creature can block
 * Rule 702.147a - "This creature can't block"
 * @param hasDecayed - Whether creature has decayed
 * @returns False (can't block)
 */
export function canBlockWithDecayed(hasDecayed: boolean): boolean {
  return !hasDecayed;
}

/**
 * Trigger decayed when attacking
 * Rule 702.147a - Sacrifice at end of combat
 * @param ability - Decayed ability
 * @returns Updated ability
 */
export function triggerDecayed(ability: DecayedAbility): DecayedAbility {
  return {
    ...ability,
    hasAttacked: true,
  };
}

/**
 * Check if should sacrifice at end of combat
 * Rule 702.147a
 * @param ability - Decayed ability
 * @returns True if should sacrifice
 */
export function shouldSacrificeDecayed(ability: DecayedAbility): boolean {
  return ability.hasAttacked;
}

/**
 * Multiple instances of decayed are redundant
 * @param abilities - Array of decayed abilities
 * @returns True if more than one
 */
export function hasRedundantDecayed(abilities: readonly DecayedAbility[]): boolean {
  return abilities.length > 1;
}
