/**
 * Exhaust keyword ability (Rule 702.177)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.177. Exhaust
 * 702.177a An exhaust ability is a special kind of activated ability. "Exhaust — [Cost]: [Effect]" 
 * means "[Cost]: [Effect]. Activate only once."
 * 702.177b An effect may allow you to take an action as long as you haven't activated an exhaust 
 * ability this turn. Such an effect allows that action only if you haven't begun to activate an 
 * exhaust ability this turn.
 */

export interface ExhaustAbility {
  readonly type: 'exhaust';
  readonly source: string;
  readonly exhaustCost: string;
  readonly effect: string;
  readonly hasBeenActivated: boolean;
}

/**
 * Create an exhaust ability
 * Rule 702.177a
 * @param source - The permanent with exhaust
 * @param exhaustCost - Cost to activate
 * @param effect - Effect of the ability
 * @returns Exhaust ability object
 */
export function exhaust(source: string, exhaustCost: string, effect: string): ExhaustAbility {
  return {
    type: 'exhaust',
    source,
    exhaustCost,
    effect,
    hasBeenActivated: false,
  };
}

/**
 * Activate exhaust ability
 * Rule 702.177a - Activate only once
 * @param ability - Exhaust ability
 * @returns Updated ability or null if already activated
 */
export function activateExhaust(ability: ExhaustAbility): ExhaustAbility | null {
  if (ability.hasBeenActivated) {
    return null;
  }
  
  return {
    ...ability,
    hasBeenActivated: true,
  };
}

/**
 * Check if exhaust ability has been activated
 * @param ability - Exhaust ability
 * @returns True if activated
 */
export function hasActivatedExhaust(ability: ExhaustAbility): boolean {
  return ability.hasBeenActivated;
}

/**
 * Multiple instances of exhaust are not redundant
 * @param abilities - Array of exhaust abilities
 * @returns False
 */
export function hasRedundantExhaust(abilities: readonly ExhaustAbility[]): boolean {
  return false;
}
