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
 * Checks whether a conspire cost can be paid with the chosen creatures.
 *
 * @param creatures - The creatures chosen to pay conspire
 * @param shareColorWithSpell - Whether each chosen creature shares a color with the spell
 * @returns True if the chosen creatures can pay conspire
 */
export function canPayConspireCost(
  creatures: readonly string[],
  shareColorWithSpell: boolean
): boolean {
  return creatures.length === 2 && shareColorWithSpell;
}

/**
 * Creates the copy result from a conspired spell.
 *
 * @param ability - The conspire ability
 * @returns Copy summary, or null if the conspire cost was not paid
 */
export function createConspireCopyResult(
  ability: ConspireAbility
): {
  source: string;
  copied: true;
  tappedCreatures: readonly string[];
} | null {
  if (!ability.wasPaid || !ability.tappedCreatures) {
    return null;
  }

  return {
    source: ability.source,
    copied: true,
    tappedCreatures: ability.tappedCreatures,
  };
}

/**
 * Check if two conspire abilities are redundant
 * Rule 702.78b: Multiple instances trigger separately
 */
export function areConspireAbilitiesRedundant(a: ConspireAbility, b: ConspireAbility): boolean {
  return false;
}
