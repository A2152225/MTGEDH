/**
 * Champion keyword ability (Rule 702.72)
 * 
 * @module keywordAbilities/champion
 */

/**
 * Represents a champion ability on a permanent.
 * Rule 702.72: Champion represents two triggered abilities. "Champion an [object]" 
 * means "When this permanent enters the battlefield, sacrifice it unless you exile 
 * another [object] you control" and "When this permanent leaves the battlefield, 
 * return the exiled card to the battlefield under its owner's control."
 */
export interface ChampionAbility {
  readonly type: 'champion';
  readonly objectType: string;
  readonly source: string;
  readonly championedCard?: string;
}

/**
 * Creates a champion ability.
 * 
 * @param source - The source permanent with champion
 * @param objectType - Type of object to champion
 * @returns A champion ability
 * 
 * @example
 * ```typescript
 * const ability = champion('Changeling Hero', 'Shapeshifter');
 * ```
 */
export function champion(source: string, objectType: string): ChampionAbility {
  return {
    type: 'champion',
    objectType,
    source
  };
}

/**
 * Champions a card.
 * 
 * @param ability - The champion ability
 * @param cardId - ID of the card being championed
 * @returns Updated ability
 */
export function setChampionedCard(ability: ChampionAbility, cardId: string): ChampionAbility {
  return {
    ...ability,
    championedCard: cardId
  };
}

/**
 * Checks if a card was championed.
 * 
 * @param ability - The champion ability
 * @returns True if a card is championed
 */
export function hasChampionedCard(ability: ChampionAbility): boolean {
  return ability.championedCard !== undefined;
}

/**
 * Checks whether a permanent can be championed for this ability.
 *
 * @param ability - The champion ability
 * @param candidateTypes - The candidate permanent's types or subtypes
 * @param candidateId - The candidate permanent id
 * @returns True if the candidate can satisfy champion
 */
export function canChampionObject(
  ability: ChampionAbility,
  candidateTypes: readonly string[],
  candidateId: string
): boolean {
  return candidateId !== ability.source
    && candidateTypes.some(type => type.trim().toLowerCase() === ability.objectType.trim().toLowerCase());
}

/**
 * Creates the ETB exile summary for champion.
 *
 * @param ability - The champion ability after choosing a card to champion
 * @param candidateTypes - The chosen card's types or subtypes
 * @returns Exile summary, or null if the chosen card cannot be championed
 */
export function createChampionExileResult(
  ability: ChampionAbility,
  candidateTypes: readonly string[]
): {
  source: string;
  championedCard: string;
  exilesChosenCard: true;
} | null {
  if (!ability.championedCard || !canChampionObject(ability, candidateTypes, ability.championedCard)) {
    return null;
  }

  return {
    source: ability.source,
    championedCard: ability.championedCard,
    exilesChosenCard: true,
  };
}

/**
 * Creates the LTB return summary for champion.
 *
 * @param ability - The champion ability
 * @returns Return summary, or null if nothing was championed
 */
export function createChampionReturnResult(
  ability: ChampionAbility
): {
  source: string;
  returningCard: string;
  returnsToBattlefield: true;
} | null {
  if (!ability.championedCard) {
    return null;
  }

  return {
    source: ability.source,
    returningCard: ability.championedCard,
    returnsToBattlefield: true,
  };
}
