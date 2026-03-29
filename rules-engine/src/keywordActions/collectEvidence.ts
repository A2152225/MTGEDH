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

type ManaValueLike = {
  readonly manaValue?: number;
  readonly mana_value?: number;
  readonly cmc?: number;
  readonly card?: {
    readonly manaValue?: number;
    readonly mana_value?: number;
    readonly cmc?: number;
  };
};

function getManaValue(card: ManaValueLike): number {
  const candidates = [
    card.manaValue,
    card.mana_value,
    card.cmc,
    card.card?.manaValue,
    card.card?.mana_value,
    card.card?.cmc,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return Math.max(0, candidate);
    }
  }

  return 0;
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

/**
 * Sum the mana value of a set of candidate evidence cards.
 */
export function getCollectedEvidenceTotal(cards: readonly ManaValueLike[]): number {
  return cards.reduce((sum, card) => sum + getManaValue(card), 0);
}

/**
 * Check whether the selected cards provide enough evidence.
 */
export function canCollectEvidenceWithCards(cards: readonly ManaValueLike[], n: number): boolean {
  return getCollectedEvidenceTotal(cards) >= n;
}

/**
 * Return how much more mana value is still needed.
 */
export function getEvidenceShortfall(totalManaValue: number, n: number): number {
  return Math.max(0, n - Math.max(0, totalManaValue));
}
