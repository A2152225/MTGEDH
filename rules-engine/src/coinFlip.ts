/**
 * Rule 705: Flipping a Coin
 * 
 * Some cards refer to flipping a coin. A coin used in a flip must be a
 * two-sided object with easily distinguished sides and equal likelihood that
 * either side lands face up.
 * 
 * Reference: MagicCompRules 20251114.txt, Rule 705
 */

/**
 * Rule 705.1: Coin characteristics
 * 
 * A coin used in a flip must be a two-sided object with easily distinguished
 * sides and equal likelihood that either side lands face up. If the coin that's
 * being flipped doesn't have an obvious "heads" or "tails," designate one side
 * to be "heads," and the other side to be "tails." Other methods of
 * randomization may be substituted for flipping a coin as long as there are two
 * possible outcomes of equal likelihood and all players agree to the
 * substitution.
 */

export type CoinSide = 'heads' | 'tails';

export interface CoinFlip {
  readonly playerId: string;
  readonly result: CoinSide;
  readonly won: boolean; // True if the player won the flip
  readonly call?: CoinSide; // The player's call (if applicable)
}

/**
 * Rule 705.2: Winning a coin flip
 * 
 * Some effects that instruct a player to flip a coin care only about whether
 * the coin comes up heads or tails. No player wins or loses a coin flip for
 * this kind of effect. For all other effects that instruct a player to flip a
 * coin, the player that flips the coin calls "heads" or "tails." If the call
 * matches the result, the player wins the flip. Otherwise, the player loses the
 * flip. Only the player who flips the coin wins or loses the flip; no other
 * players are involved.
 */

/**
 * Flip a coin without a call (just checking the result)
 * 
 * Used for effects that only care about heads or tails, not winning/losing.
 */
export function flipCoin(playerId: string, result: CoinSide): CoinFlip {
  return {
    playerId,
    result,
    won: false, // No winner for effects that only care about result
  };
}

/**
 * Flip a coin with a player's call
 * 
 * The player calls heads or tails. If the call matches the result, the player
 * wins the flip.
 */
export function flipCoinWithCall(
  playerId: string,
  call: CoinSide,
  result: CoinSide
): CoinFlip {
  return {
    playerId,
    result,
    call,
    won: call === result,
  };
}

/**
 * Rule 705.3: Forced coin flip results
 * 
 * An effect may state that a coin flip has a certain result and/or that a
 * certain player wins a coin flip. In that case, ignore the actual results of
 * that flip and use the indicated results instead. This can cause a player to
 * win a flip that couldn't otherwise be won.
 */
export function forceCoinFlipResult(
  playerId: string,
  forcedResult: CoinSide,
  forcedWin?: boolean
): CoinFlip {
  return {
    playerId,
    result: forcedResult,
    won: forcedWin ?? false,
  };
}

/**
 * Helper function to randomly generate a coin flip result
 * 
 * This simulates the actual randomization. In a real implementation, this would
 * use a proper random number generator.
 */
export function generateCoinFlipResult(): CoinSide {
  return Math.random() < 0.5 ? 'heads' : 'tails';
}

/**
 * Check if a coin flip was won by the player
 */
export function didWinCoinFlip(flip: CoinFlip): boolean {
  return flip.won;
}

/**
 * Check if a coin flip resulted in heads
 */
export function isHeads(flip: CoinFlip): boolean {
  return flip.result === 'heads';
}

/**
 * Check if a coin flip resulted in tails
 */
export function isTails(flip: CoinFlip): boolean {
  return flip.result === 'tails';
}

/**
 * Perform a complete coin flip with call and result
 * 
 * This is the most common use case: a player flips a coin, calls it, and we
 * determine if they won.
 */
export function performCoinFlip(
  playerId: string,
  call: CoinSide
): CoinFlip {
  const result = generateCoinFlipResult();
  return flipCoinWithCall(playerId, call, result);
}
