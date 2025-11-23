/**
 * Conspire keyword ability (Rule 702.78)
 * @module keywordAbilities/conspire
 */

/**
 * Conspire ability (Rule 702.78)
 * Represents an additional cost and triggered ability for copying spells
 */
export interface ConspireAbility {
  readonly type: 'conspire';
  readonly source: string;
  readonly wasPaid: boolean;
  readonly tappedCreatures?: readonly string[];
}

/**
 * Create a conspire ability
 * Rule 702.78a: "Conspire" means "As an additional cost to cast this spell,
 * you may tap two untapped creatures you control that each share a color with it"
 * and "When you cast this spell, if its conspire cost was paid, copy it."
 */
export function conspire(source: string): ConspireAbility {
  return {
    type: 'conspire',
    source,
    wasPaid: false
  };
}

/**
 * Pay conspire cost by tapping creatures
 */
export function payConspire(ability: ConspireAbility, creatures: readonly string[]): ConspireAbility {
  if (creatures.length !== 2) {
    throw new Error('Conspire requires tapping exactly two creatures');
  }
  return {
    ...ability,
    wasPaid: true,
    tappedCreatures: creatures
  };
}

/**
 * Check if conspire cost was paid
 */
export function wasConspired(ability: ConspireAbility): boolean {
  return ability.wasPaid;
}

/**
 * Check if two conspire abilities are redundant
 * Rule 702.78b: Multiple instances trigger separately
 */
export function areConspireAbilitiesRedundant(a: ConspireAbility, b: ConspireAbility): boolean {
  return false;
}
