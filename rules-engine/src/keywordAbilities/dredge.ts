/**
 * Dredge keyword ability implementation (Rule 702.52)
 * @see MagicCompRules 702.52
 */

export interface DredgeAbility {
  readonly type: 'dredge';
  readonly value: number;
  readonly source: string;
  readonly wasDredged: boolean;
}

export function dredge(source: string, value: number): DredgeAbility {
  return { type: 'dredge', value, source, wasDredged: false };
}

export function useDredge(ability: DredgeAbility): DredgeAbility {
  return { ...ability, wasDredged: true };
}

export function canDredge(librarySize: number, ability: DredgeAbility): boolean {
  return librarySize >= ability.value;
}

/**
 * Checks whether dredge can be used from the given zone.
 * Dredge functions while the card is in a graveyard and you would draw a card.
 *
 * @param ability - The dredge ability
 * @param zone - The card's current zone
 * @param librarySize - The current library size
 * @returns True if dredge can replace the draw
 */
export function canDredgeFromZone(
  ability: DredgeAbility,
  zone: string,
  librarySize: number
): boolean {
  return zone === 'graveyard' && canDredge(librarySize, ability);
}

/**
 * Creates the replacement-effect result for dredge.
 *
 * @param ability - The dredge ability
 * @param zone - The card's current zone
 * @param librarySize - The current library size
 * @returns Summary of milling and returning the card to hand, or null if dredge cannot be used
 */
export function createDredgeResult(
  ability: DredgeAbility,
  zone: string,
  librarySize: number
): {
  source: string;
  milledCards: number;
  returnsToHand: true;
} | null {
  if (!canDredgeFromZone(ability, zone, librarySize)) {
    return null;
  }

  return {
    source: ability.source,
    milledCards: ability.value,
    returnsToHand: true,
  };
}
