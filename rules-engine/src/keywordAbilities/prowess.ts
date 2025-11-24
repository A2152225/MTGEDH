/**
 * Prowess keyword ability (Rule 702.108)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.108. Prowess
 * 702.108a Prowess is a triggered ability. "Prowess" means "Whenever you cast a noncreature 
 * spell, this creature gets +1/+1 until end of turn."
 * 702.108b If a creature has multiple instances of prowess, each triggers separately.
 */

export interface ProwessAbility {
  readonly type: 'prowess';
  readonly source: string;
  readonly triggersThisTurn: number;
  readonly bonusUntilEndOfTurn: number;
  readonly triggered: boolean;
}

/**
 * Create a prowess ability
 * Rule 702.108a
 */
export function prowess(source: string): ProwessAbility {
  return {
    type: 'prowess',
    source,
    triggersThisTurn: 0,
    bonusUntilEndOfTurn: 0,
    triggered: false,
  };
}

/**
 * Trigger prowess when a noncreature spell is cast
 * Rule 702.108a - Gives +1/+1 until end of turn
 */
export function triggerProwess(ability: ProwessAbility): ProwessAbility {
  return {
    ...ability,
    triggersThisTurn: ability.triggersThisTurn + 1,
    bonusUntilEndOfTurn: ability.bonusUntilEndOfTurn + 1,
    triggered: true,
  };
}

/**
 * Clear prowess bonuses at end of turn
 */
export function clearProwessBonus(ability: ProwessAbility): ProwessAbility {
  return {
    ...ability,
    bonusUntilEndOfTurn: 0,
    triggered: false,
  };
}

/**
 * Get current prowess bonus
 */
export function getProwessBonus(ability: ProwessAbility): number {
  return ability.bonusUntilEndOfTurn;
}

/**
 * Get total prowess triggers this turn
 */
export function getProwessTriggers(ability: ProwessAbility): number {
  return ability.triggersThisTurn;
}

/**
 * Multiple instances of prowess trigger separately
 * Rule 702.108b
 */
export function hasRedundantProwess(
  abilities: readonly ProwessAbility[]
): boolean {
  return false; // Each instance triggers separately
}
