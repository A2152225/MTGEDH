/**
 * Cascade keyword ability (Rule 702.85)
 * @module keywordAbilities/cascade
 */

/**
 * Cascade ability (Rule 702.85)
 * Triggered ability that exiles cards and casts one
 */
export interface CascadeAbility {
  readonly type: 'cascade';
  readonly source: string;
  readonly exiledCards?: readonly string[];
  readonly castCard?: string;
}

/**
 * Create a cascade ability
 * Rule 702.85a: "Cascade" means "When you cast this spell, exile cards from
 * the top of your library until you exile a nonland card whose mana value is
 * less than this spell's mana value. You may cast that card without paying its
 * mana cost if the resulting spell's mana value is less than this spell's mana
 * value."
 */
export function cascade(source: string): CascadeAbility {
  return {
    type: 'cascade',
    source
  };
}

/**
 * Resolve cascade by exiling cards
 */
export function resolveCascade(
  ability: CascadeAbility,
  exiledCards: readonly string[],
  castCard?: string
): CascadeAbility {
  return {
    ...ability,
    exiledCards,
    castCard
  };
}

/**
 * Check if card can be cast with cascade
 * Must be nonland with lower mana value
 */
export function canCascadeInto(spellManaValue: number, cardManaValue: number, isLand: boolean): boolean {
  return !isLand && cardManaValue < spellManaValue;
}

/**
 * Check if two cascade abilities are redundant
 * Rule 702.85c: Multiple instances trigger separately
 */
export function areCascadeAbilitiesRedundant(a: CascadeAbility, b: CascadeAbility): boolean {
  return false;
}
