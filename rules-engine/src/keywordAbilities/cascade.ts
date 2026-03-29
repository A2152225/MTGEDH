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

export interface CascadeCandidate {
  readonly cardId: string;
  readonly manaValue: number;
  readonly isLand: boolean;
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
 * Gets the exiled cards that may be cast with cascade.
 *
 * @param spellManaValue - Mana value of the spell with cascade
 * @param exiledCards - The cards exiled while resolving cascade
 * @returns IDs of cards that cascade allows the player to cast
 */
export function getCascadeCastableCards(
  spellManaValue: number,
  exiledCards: readonly CascadeCandidate[]
): string[] {
  return exiledCards
    .filter(card => canCascadeInto(spellManaValue, card.manaValue, card.isLand))
    .map(card => card.cardId);
}

/**
 * Creates the resolution summary for a cascade trigger.
 *
 * @param ability - The cascade ability
 * @param spellManaValue - Mana value of the spell with cascade
 * @param exiledCards - The cards exiled while resolving cascade
 * @param chosenCard - The chosen castable card, if any
 * @returns Summary of exiled cards and available cascade hits
 */
export function createCascadeResolutionResult(
  ability: CascadeAbility,
  spellManaValue: number,
  exiledCards: readonly CascadeCandidate[],
  chosenCard?: string
): {
  source: string;
  exiledCards: readonly string[];
  castableCards: readonly string[];
  chosenCard?: string;
} {
  const castableCards = getCascadeCastableCards(spellManaValue, exiledCards);
  return {
    source: ability.source,
    exiledCards: exiledCards.map(card => card.cardId),
    castableCards,
    chosenCard: chosenCard && castableCards.includes(chosenCard) ? chosenCard : undefined,
  };
}

/**
 * Check if two cascade abilities are redundant
 * Rule 702.85c: Multiple instances trigger separately
 */
export function areCascadeAbilitiesRedundant(a: CascadeAbility, b: CascadeAbility): boolean {
  return false;
}
