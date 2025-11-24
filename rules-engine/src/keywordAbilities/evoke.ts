/**
 * Evoke keyword ability (Rule 702.74)
 * @module keywordAbilities/evoke
 */

/**
 * Evoke ability (Rule 702.74)
 * Represents two abilities: a static ability allowing casting by paying evoke cost,
 * and a triggered ability that sacrifices the permanent on entry if evoke was paid.
 */
export interface EvokeAbility {
  readonly type: 'evoke';
  readonly source: string;
  readonly cost: string;
  readonly wasPaid: boolean;
}

/**
 * Create an evoke ability
 * Rule 702.74a: "Evoke [cost]" means "You may cast this card by paying [cost]
 * rather than paying its mana cost" and "When this permanent enters, if its
 * evoke cost was paid, its controller sacrifices it."
 */
export function evoke(source: string, cost: string): EvokeAbility {
  return {
    type: 'evoke',
    source,
    cost,
    wasPaid: false
  };
}

/**
 * Mark evoke cost as paid
 */
export function payEvoke(ability: EvokeAbility): EvokeAbility {
  return {
    ...ability,
    wasPaid: true
  };
}

/**
 * Check if evoke cost was paid
 */
export function wasEvoked(ability: EvokeAbility): boolean {
  return ability.wasPaid;
}

/**
 * Get the evoke sacrifice trigger
 * Triggers when permanent enters if evoke cost was paid
 */
export function getEvokeSacrificeTrigger(ability: EvokeAbility): boolean {
  return ability.wasPaid;
}

/**
 * Check if two evoke abilities are redundant
 * Multiple instances with different costs are not redundant
 */
export function areEvokeAbilitiesRedundant(a: EvokeAbility, b: EvokeAbility): boolean {
  return a.cost === b.cost;
}
