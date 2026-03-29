/**
 * Transfigure keyword ability (Rule 702.71)
 * 
 * @module keywordAbilities/transfigure
 */

/**
 * Represents a transfigure ability on a creature.
 * Rule 702.71: Transfigure is an activated ability. "Transfigure [cost]" means "[Cost], 
 * Sacrifice this permanent: Search your library for a creature card with the same mana 
 * value as this permanent, put it onto the battlefield, then shuffle. Activate only as 
 * a sorcery."
 */
export interface TransfigureAbility {
  readonly type: 'transfigure';
  readonly cost: string;
  readonly source: string;
}

export interface TransfigureResult {
  readonly sacrificedSourceId: string;
  readonly selectedCardId: string;
  readonly requiredManaValue: number;
}

/**
 * Creates a transfigure ability.
 * 
 * @param source - The source creature with transfigure
 * @param cost - The transfigure cost
 * @returns A transfigure ability
 * 
 * @example
 * ```typescript
 * const ability = transfigure('Fleshwrither', '{1}{B}{B}');
 * ```
 */
export function transfigure(source: string, cost: string): TransfigureAbility {
  return {
    type: 'transfigure',
    cost,
    source
  };
}

export function canActivateTransfigure(
  isSorcerySpeed: boolean,
  isOnBattlefield: boolean,
  controllerHasPriority: boolean = true
): boolean {
  return isSorcerySpeed && isOnBattlefield && controllerHasPriority;
}

export function canFindTransfigureTarget(
  sourceManaValue: number,
  candidateManaValue: number
): boolean {
  return sourceManaValue === candidateManaValue;
}

export function getTransfigureCandidates<T extends { id: string; manaValue: number }>(
  sourceManaValue: number,
  cards: readonly T[]
): T[] {
  return cards.filter(card => canFindTransfigureTarget(sourceManaValue, card.manaValue));
}

export function resolveTransfigure(
  ability: TransfigureAbility,
  sourceManaValue: number,
  selectedCardId: string
): TransfigureResult {
  return {
    sacrificedSourceId: ability.source,
    selectedCardId,
    requiredManaValue: sourceManaValue,
  };
}
