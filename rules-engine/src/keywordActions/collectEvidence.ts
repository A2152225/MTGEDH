/**
 * Rule 701.59: Collect Evidence
 * 
 * To "collect evidence N" means to exile any number of cards from your graveyard
 * with total mana value N or greater.
 * 
 * Reference: Rule 701.59
 */

export interface CollectEvidenceAction {
  readonly type: 'collect-evidence';
  readonly playerId: string;
  readonly n: number;
  readonly exiledCardIds?: readonly string[];
  readonly totalManaValue?: number;
}

/**
 * Rule 701.59a: Collect evidence N
 */
export function collectEvidence(playerId: string, n: number): CollectEvidenceAction {
  return {
    type: 'collect-evidence',
    playerId,
    n,
  };
}

/**
 * Complete collect evidence
 */
export function completeCollectEvidence(
  playerId: string,
  n: number,
  exiledCardIds: readonly string[],
  totalManaValue: number
): CollectEvidenceAction {
  return {
    type: 'collect-evidence',
    playerId,
    n,
    exiledCardIds,
    totalManaValue,
  };
}

/**
 * Rule 701.59b: Can't collect if insufficient cards
 */
export function canCollectEvidence(
  graveyardTotalManaValue: number,
  n: number
): boolean {
  return graveyardTotalManaValue >= n;
}

/**
 * Validate evidence collection
 */
export function isValidEvidence(
  cardsManaValues: readonly number[],
  n: number
): boolean {
  const total = cardsManaValues.reduce((sum, mv) => sum + mv, 0);
  return total >= n;
}
