/**
 * Rule 701.30: Clash
 * 
 * To clash, a player reveals the top card of their library. That player may
 * then put that card on the bottom of their library.
 * 
 * Reference: Rule 701.30
 */

export interface ClashAction {
  readonly type: 'clash';
  readonly playerId: string;
  readonly opponentId?: string; // For "clash with an opponent"
  readonly revealedCard?: string;
  readonly putOnBottom?: boolean;
}

export interface ClashResult {
  readonly playerId: string;
  readonly revealedCard: string;
  readonly manaValue: number;
  readonly putOnBottom: boolean;
  readonly wonClash: boolean;
}

/**
 * Rule 701.30a: Clash
 * 
 * To clash, a player reveals the top card of their library. That player may
 * then put that card on the bottom of their library.
 */
export function clash(playerId: string): ClashAction {
  return {
    type: 'clash',
    playerId,
  };
}

/**
 * Rule 701.30b: Clash with an opponent
 * 
 * "Clash with an opponent" means "Choose an opponent. You and that opponent
 * each clash."
 */
export function clashWithOpponent(
  playerId: string,
  opponentId: string
): ClashAction {
  return {
    type: 'clash',
    playerId,
    opponentId,
  };
}

/**
 * Complete a clash action with card revealed and decision
 */
export function completeClash(
  playerId: string,
  revealedCard: string,
  putOnBottom: boolean,
  opponentId?: string
): ClashAction {
  return {
    type: 'clash',
    playerId,
    opponentId,
    revealedCard,
    putOnBottom,
  };
}

/**
 * Rule 701.30c: Simultaneous reveal and APNAP order
 * 
 * Each clashing player reveals the top card of their library at the same time.
 * Then those players decide in APNAP order where to put those cards, then
 * those cards move at the same time.
 */
export function resolveClashes(
  clashes: readonly {
    playerId: string;
    revealedCard: string;
    manaValue: number;
    putOnBottom: boolean;
  }[]
): readonly ClashResult[] {
  // Find the highest mana value
  const maxManaValue = Math.max(...clashes.map(c => c.manaValue));
  
  return clashes.map(clash => ({
    ...clash,
    wonClash: clash.manaValue > 0 && clash.manaValue === maxManaValue,
  }));
}

/**
 * Rule 701.30d: Winning a clash
 * 
 * A player wins a clash if that player revealed a card with a higher mana value
 * than all other cards revealed in that clash.
 */
export function wonClash(
  playerManaValue: number,
  otherManaValues: readonly number[]
): boolean {
  if (otherManaValues.length === 0) {
    // Solo clash - always wins if revealed a card
    return playerManaValue > 0;
  }
  
  const maxOtherValue = Math.max(...otherManaValues);
  return playerManaValue > maxOtherValue;
}
