/**
 * Gravestorm keyword ability (Rule 702.69)
 * 
 * @module keywordAbilities/gravestorm
 */

/**
 * Represents a gravestorm ability on a spell.
 * Rule 702.69: Gravestorm is a triggered ability that functions on the stack. 
 * "Gravestorm" means "When you cast this spell, copy it for each permanent that was 
 * put into a graveyard from the battlefield this turn. If the spell has any targets, 
 * you may choose new targets for any of the copies."
 */
export interface GravestormAbility {
  readonly type: 'gravestorm';
  readonly source: string;
  readonly permanentsDiedThisTurn: number;
}

/**
 * Creates a gravestorm ability.
 * 
 * @param source - The source spell with gravestorm
 * @param permanentsDiedThisTurn - Number of permanents that died this turn
 * @returns A gravestorm ability
 * 
 * @example
 * ```typescript
 * const ability = gravestorm('Bitter Ordeal', 3);
 * ```
 */
export function gravestorm(source: string, permanentsDiedThisTurn: number): GravestormAbility {
  return {
    type: 'gravestorm',
    source,
    permanentsDiedThisTurn
  };
}

/**
 * Gets the number of copies to create.
 * 
 * @param ability - The gravestorm ability
 * @returns Number of copies
 */
export function getGravestormCopies(ability: GravestormAbility): number {
  return ability.permanentsDiedThisTurn;
}

/**
 * Gets the IDs of copies created by gravestorm.
 *
 * @param ability - The gravestorm ability
 * @returns Generated copy IDs in death-count order
 */
export function getGravestormCopyIds(ability: GravestormAbility): readonly string[] {
  return Array.from(
    { length: ability.permanentsDiedThisTurn },
    (_, index) => `${ability.source}-gravestorm-copy-${index + 1}`
  );
}

/**
 * Creates the resolution summary for gravestorm.
 *
 * @param ability - The gravestorm ability
 * @returns Summary of copies created by gravestorm
 */
export function createGravestormResolutionResult(ability: GravestormAbility): {
  source: string;
  copiesCreated: number;
  copyIds: readonly string[];
} {
  return {
    source: ability.source,
    copiesCreated: getGravestormCopies(ability),
    copyIds: getGravestormCopyIds(ability),
  };
}
