/**
 * Boast keyword ability (Rule 702.142)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.142. Boast
 * 702.142a A boast ability is a special kind of activated ability. "Boast — [Cost]: [Effect]" 
 * means "[Cost]: [Effect]. Activate only if this creature attacked this turn and only once each 
 * turn."
 * 702.142b Effects may refer to boast abilities. If an effect refers to a creature boasting, it 
 * means its boast ability being activated.
 */

export interface BoastAbility {
  readonly type: 'boast';
  readonly source: string;
  readonly boastCost: string;
  readonly effect: string;
  readonly attackedThisTurn: boolean;
  readonly activatedThisTurn: boolean;
}

/**
 * Create a boast ability
 * Rule 702.142a
 * @param source - The creature with boast
 * @param boastCost - Cost to activate boast
 * @param effect - Effect of the boast ability
 * @returns Boast ability object
 */
export function boast(source: string, boastCost: string, effect: string): BoastAbility {
  return {
    type: 'boast',
    source,
    boastCost,
    effect,
    attackedThisTurn: false,
    activatedThisTurn: false,
  };
}

/**
 * Mark creature as having attacked this turn
 * Rule 702.142a - Required to activate boast
 * @param ability - Boast ability
 * @returns Updated ability
 */
export function markAttacked(ability: BoastAbility): BoastAbility {
  return {
    ...ability,
    attackedThisTurn: true,
  };
}

/**
 * Check if boast can be activated
 * Rule 702.142a - Only if attacked this turn and not yet activated this turn
 * @param ability - Boast ability
 * @returns True if can activate
 */
export function canActivateBoast(ability: BoastAbility): boolean {
  return ability.attackedThisTurn && !ability.activatedThisTurn;
}

/**
 * Activate boast ability
 * Rule 702.142a - Can only activate once per turn
 * Rule 702.142b - "Boasting" means activating boast ability
 * @param ability - Boast ability
 * @returns Updated ability
 */
export function activateBoast(ability: BoastAbility): BoastAbility {
  if (!canActivateBoast(ability)) {
    return ability;
  }
  
  return {
    ...ability,
    activatedThisTurn: true,
  };
}

/**
 * Reset boast at end of turn
 * @param ability - Boast ability
 * @returns Ability with turn flags reset
 */
export function resetBoast(ability: BoastAbility): BoastAbility {
  return {
    ...ability,
    attackedThisTurn: false,
    activatedThisTurn: false,
  };
}

/**
 * Multiple instances of boast are not redundant
 * @param abilities - Array of boast abilities
 * @returns False
 */
export function hasRedundantBoast(abilities: readonly BoastAbility[]): boolean {
  return false;
}
