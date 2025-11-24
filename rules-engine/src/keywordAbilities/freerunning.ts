/**
 * Freerunning keyword ability (Rule 702.173)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.173. Freerunning
 * 702.173a Freerunning is a static ability that functions on the stack. "Freerunning [cost]" 
 * means "You may pay [cost] rather than pay this spell's mana cost if a player was dealt combat 
 * damage this turn by a creature that, at the time it dealt that damage, was an Assassin creature 
 * or a commander under your control."
 */

export interface FreerunningAbility {
  readonly type: 'freerunning';
  readonly source: string;
  readonly freerunningCost: string;
  readonly wasFreerun: boolean;
}

/**
 * Create a freerunning ability
 * Rule 702.173a
 * @param source - The spell with freerunning
 * @param freerunningCost - Alternative cost
 * @returns Freerunning ability object
 */
export function freerunning(source: string, freerunningCost: string): FreerunningAbility {
  return {
    type: 'freerunning',
    source,
    freerunningCost,
    wasFreerun: false,
  };
}

/**
 * Cast spell with freerunning cost
 * Rule 702.173a - If Assassin/commander dealt combat damage this turn
 * @param ability - Freerunning ability
 * @returns Updated ability
 */
export function castWithFreerunning(ability: FreerunningAbility): FreerunningAbility {
  return {
    ...ability,
    wasFreerun: true,
  };
}

/**
 * Check if spell was freerun
 * @param ability - Freerunning ability
 * @returns True if freerun
 */
export function wasFreerun(ability: FreerunningAbility): boolean {
  return ability.wasFreerun;
}

/**
 * Get freerunning cost
 * @param ability - Freerunning ability
 * @returns Freerunning cost string
 */
export function getFreerunningCost(ability: FreerunningAbility): string {
  return ability.freerunningCost;
}

/**
 * Multiple instances of freerunning are not redundant
 * @param abilities - Array of freerunning abilities
 * @returns False
 */
export function hasRedundantFreerunning(abilities: readonly FreerunningAbility[]): boolean {
  return false;
}
