/**
 * Rule 701.50: Connive
 * 
 * Certain spells and abilities instruct a permanent to connive. To do so, that
 * permanent's controller draws a card, then discards a card. If a nonland card
 * is discarded this way, that player puts a +1/+1 counter on the conniving
 * permanent.
 * 
 * Reference: Rule 701.50
 */

export interface ConniveAction {
  readonly type: 'connive';
  readonly permanentId: string;
  readonly controllerId: string;
  readonly n?: number; // For "Connive N" variant
  readonly drawnCards?: number;
  readonly discardedNonlandCount?: number;
}

/**
 * Rule 701.50a: Connive
 */
export function connive(permanentId: string, controllerId: string): ConniveAction {
  return {
    type: 'connive',
    permanentId,
    controllerId,
  };
}

/**
 * Rule 701.50e: Connive N
 */
export function conniveN(
  permanentId: string,
  controllerId: string,
  n: number
): ConniveAction {
  return {
    type: 'connive',
    permanentId,
    controllerId,
    n,
  };
}

/**
 * Complete connive
 */
export function completeConnive(
  permanentId: string,
  controllerId: string,
  nonlandCount: number,
  n: number = 1
): ConniveAction {
  return {
    type: 'connive',
    permanentId,
    controllerId,
    n,
    drawnCards: n,
    discardedNonlandCount: nonlandCount,
  };
}

/**
 * Rule 701.50b: Connived even if impossible
 */
export const CONNIVED_EVEN_IF_IMPOSSIBLE = true;

/**
 * Rule 701.50c: Last known information
 */
export function useLastKnownInformationForConnive(
  permanentChangedZones: boolean
): boolean {
  return permanentChangedZones;
}

/**
 * Rule 701.50d: APNAP order
 */
export function sortMultipleConnives(
  permanents: readonly { id: string; controllerId: string }[],
  apnapOrder: readonly string[]
): readonly { id: string; controllerId: string }[] {
  return [...permanents].sort((a, b) => {
    const indexA = apnapOrder.indexOf(a.controllerId);
    const indexB = apnapOrder.indexOf(b.controllerId);
    return indexA - indexB;
  });
}
