/**
 * Rule 701.25: Surveil
 * 
 * To "surveil N" means to look at the top N cards of your library, then put any
 * number of them into your graveyard and the rest on top of your library in any
 * order.
 * 
 * Reference: Rule 701.25
 */

export interface SurveilAction {
  readonly type: 'surveil';
  readonly playerId: string;
  readonly count: number;
  readonly toGraveyard?: readonly string[]; // Cards to put in graveyard
  readonly toTop?: readonly string[]; // Cards to keep on top (in order)
}

/**
 * Rule 701.25a: Surveil N
 * 
 * To "surveil N" means to look at the top N cards of your library, then put any
 * number of them into your graveyard and the rest on top of your library in any
 * order.
 */
export function surveil(playerId: string, count: number): SurveilAction {
  return {
    type: 'surveil',
    playerId,
    count,
  };
}

/**
 * Rule 701.25b: Can't surveil more than library size
 * 
 * If a player is instructed to surveil a number greater than the number of cards
 * in their library, they surveil a number equal to the number of cards in their
 * library.
 */
export function getActualSurveilCount(
  librarySize: number,
  requestedCount: number
): number {
  return Math.min(librarySize, requestedCount);
}

/**
 * Complete a surveil action with decisions
 */
export function completeSurveil(
  playerId: string,
  count: number,
  toGraveyard: readonly string[],
  toTop: readonly string[]
): SurveilAction {
  // Validate that all surveilled cards are accounted for
  if (toGraveyard.length + toTop.length !== count) {
    throw new Error('Surveil decision must account for all cards');
  }
  
  return {
    type: 'surveil',
    playerId,
    count,
    toGraveyard,
    toTop,
  };
}

/**
 * Rule 701.25c: Surveil 0
 * 
 * If a player is instructed to surveil 0, no surveil event occurs. Abilities
 * that trigger whenever a player surveils won't trigger.
 */
export function shouldTriggerSurveil(count: number): boolean {
  return count > 0;
}

/**
 * Surveil vs Scry comparison
 * 
 * Surveil is similar to scry, but cards can go to graveyard instead of bottom
 * of library. This provides card selection and graveyard setup.
 */
export const SURVEIL_VS_SCRY_DIFFERENCE = {
  scry: 'top or bottom of library',
  surveil: 'top of library or graveyard',
} as const;
