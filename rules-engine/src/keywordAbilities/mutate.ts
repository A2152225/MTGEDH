/**
 * Mutate keyword ability (Rule 702.140)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.140. Mutate
 * 702.140a Mutate appears on some creature cards. It represents a static ability that functions 
 * while the spell with mutate is on the stack. "Mutate [cost]" means "You may pay [cost] rather 
 * than pay this spell's mana cost. If you do, it becomes a mutating creature spell and targets 
 * a non-Human creature with the same owner as this spell."
 * 702.140b As a mutating creature spell begins resolving, if its target is illegal, it ceases 
 * to be a mutating creature spell and continues resolving as a creature spell.
 * 702.140c As a mutating creature spell resolves, if its target is legal, it doesn't enter the 
 * battlefield. Rather, it merges with the target creature and becomes one object represented by 
 * more than one card or token. The spell's controller chooses whether the spell is put on top 
 * of the creature or on the bottom. The resulting permanent is a mutated permanent.
 * 702.140d An ability that triggers whenever a creature mutates triggers when a spell merges 
 * with a creature as a result of a resolving mutating creature spell.
 * 702.140e A mutated permanent has all abilities of each card and token that represents it. Its 
 * other characteristics are derived from the topmost card or token.
 */

export interface MutateAbility {
  readonly type: 'mutate';
  readonly source: string;
  readonly mutateCost: string;
  readonly hasMutated: boolean;
  readonly targetCreature?: string;
  readonly onTop: boolean; // Whether mutating card is on top
  readonly mergedCards: readonly string[];
}

/**
 * Create a mutate ability
 * Rule 702.140a
 * @param source - The creature card with mutate
 * @param mutateCost - Alternative cost to mutate
 * @returns Mutate ability object
 */
export function mutate(source: string, mutateCost: string): MutateAbility {
  return {
    type: 'mutate',
    source,
    mutateCost,
    hasMutated: false,
    onTop: true,
    mergedCards: [],
  };
}

/**
 * Cast spell with mutate, targeting a creature
 * Rule 702.140a - Targets non-Human creature with same owner
 * @param ability - Mutate ability
 * @param targetCreature - ID of target creature
 * @returns Updated ability
 */
export function castWithMutate(ability: MutateAbility, targetCreature: string): MutateAbility {
  return {
    ...ability,
    hasMutated: true,
    targetCreature,
  };
}

/**
 * Merge with target creature
 * Rule 702.140c - Controller chooses top or bottom
 * @param ability - Mutate ability
 * @param onTop - Whether mutating card goes on top
 * @param mergedCards - IDs of all cards in mutated permanent
 * @returns Updated ability
 */
export function completeMutate(
  ability: MutateAbility,
  onTop: boolean,
  mergedCards: readonly string[]
): MutateAbility {
  return {
    ...ability,
    onTop,
    mergedCards,
  };
}

/**
 * Check if spell was mutated
 * @param ability - Mutate ability
 * @returns True if mutated
 */
export function hasMutated(ability: MutateAbility): boolean {
  return ability.hasMutated;
}

/**
 * Check if mutating card is on top
 * Rule 702.140e - Topmost card determines characteristics
 * @param ability - Mutate ability
 * @returns True if on top
 */
export function isOnTop(ability: MutateAbility): boolean {
  return ability.onTop;
}

/**
 * Get merged cards
 * Rule 702.140e - Has all abilities of merged cards
 * @param ability - Mutate ability
 * @returns IDs of merged cards
 */
export function getMergedCards(ability: MutateAbility): readonly string[] {
  return ability.mergedCards;
}

/**
 * Multiple instances of mutate are not redundant
 * @param abilities - Array of mutate abilities
 * @returns False
 */
export function hasRedundantMutate(abilities: readonly MutateAbility[]): boolean {
  return false;
}
