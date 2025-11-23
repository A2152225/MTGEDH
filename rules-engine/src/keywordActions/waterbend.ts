/**
 * Rule 701.67: Waterbend
 * 
 * "Waterbend [cost]" means "Pay [cost]. For each generic mana in that cost, you
 * may tap an untapped artifact or creature you control rather than pay that mana."
 * 
 * Reference: Rule 701.67
 */

export interface WaterbendAction {
  readonly type: 'waterbend';
  readonly playerId: string;
  readonly cost: string;
  readonly tappedPermanents?: readonly string[];
  readonly manaPaid?: string;
}

/**
 * Rule 701.67a: Waterbend [cost]
 */
export function waterbend(playerId: string, cost: string): WaterbendAction {
  return {
    type: 'waterbend',
    playerId,
    cost,
  };
}

/**
 * Complete waterbend with payment
 */
export function completeWaterbend(
  playerId: string,
  cost: string,
  tappedPermanents: readonly string[],
  manaPaid: string
): WaterbendAction {
  return {
    type: 'waterbend',
    playerId,
    cost,
    tappedPermanents,
    manaPaid,
  };
}

/**
 * Rule 701.67b: Only for waterbend cost
 */
export const WATERBEND_ONLY_FOR_WATERBEND_COST = true;

/**
 * Rule 701.67c: Waterbend trigger
 */
export function triggersWhenWaterbends(paidWaterbendCost: boolean): boolean {
  return paidWaterbendCost;
}

/**
 * Check if can tap for waterbend
 */
export function canTapForWaterbend(
  permanent: { isArtifact: boolean; isCreature: boolean; isTapped: boolean }
): boolean {
  return (permanent.isArtifact || permanent.isCreature) && !permanent.isTapped;
}
