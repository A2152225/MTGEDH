/**
 * Rule 701.52: Roll to Visit Your Attractions
 * 
 * To roll to visit your Attractions, roll a six-sided die. Then if you control
 * one or more Attractions with a number lit up that is equal to that result, each
 * of those Attractions has been "visited" and its visit ability triggers.
 * 
 * Reference: Rule 701.52, also see Rule 717 "Attraction Cards" and Rule 702.159 "Visit"
 */

export interface RollVisitAttractionsAction {
  readonly type: 'roll-visit-attractions';
  readonly playerId: string;
  readonly rollResult?: number;
  readonly visitedAttractions?: readonly string[];
}

/**
 * Rule 701.52a: Roll to visit
 */
export function rollToVisitAttractions(playerId: string): RollVisitAttractionsAction {
  return {
    type: 'roll-visit-attractions',
    playerId,
  };
}

/**
 * Complete roll to visit
 */
export function completeRollVisit(
  playerId: string,
  rollResult: number,
  visitedAttractions: readonly string[]
): RollVisitAttractionsAction {
  return {
    type: 'roll-visit-attractions',
    playerId,
    rollResult,
    visitedAttractions,
  };
}

/**
 * Check if attraction is visited
 */
export function isAttractionVisited(
  litNumbers: readonly number[],
  rollResult: number
): boolean {
  return litNumbers.includes(rollResult);
}

/**
 * Die range
 */
export const VISIT_DIE_SIDES = 6;
