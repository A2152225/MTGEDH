/**
 * Rule 701.12: Exchange
 * 
 * A spell or ability may instruct players to exchange something as part of
 * its resolution. When such a spell or ability resolves, if the entire exchange
 * can't be completed, no part of the exchange occurs.
 * 
 * Reference: Rule 701.12
 */

export interface ExchangeAction {
  readonly type: 'exchange';
  readonly exchangeType: 'control' | 'life' | 'zones' | 'numerical-values' | 'text-boxes';
  readonly targetA: string;
  readonly targetB: string;
  readonly zone?: string; // For zone exchanges
}

/**
 * Rule 701.12a: All-or-nothing exchange
 * 
 * When such a spell or ability resolves, if the entire exchange can't be
 * completed, no part of the exchange occurs.
 */
export function canCompleteExchange(
  targetA: unknown,
  targetB: unknown
): boolean {
  // Both targets must exist and be valid
  return targetA !== null && targetB !== null;
}

/**
 * Rule 701.12b: Exchange control of permanents
 * 
 * When control of two permanents is exchanged, if those permanents are
 * controlled by different players, each of those players simultaneously gains
 * control of the permanent that was controlled by the other player.
 */
export function exchangeControl(permanentA: string, permanentB: string): ExchangeAction {
  return {
    type: 'exchange',
    exchangeType: 'control',
    targetA: permanentA,
    targetB: permanentB,
  };
}

/**
 * Rule 701.12c: Exchange life totals
 * 
 * When life totals are exchanged, each player gains or loses the amount of life
 * necessary to equal the other player's previous life total. Replacement effects
 * may modify these gains and losses.
 */
export function exchangeLifeTotals(playerA: string, playerB: string): ExchangeAction {
  return {
    type: 'exchange',
    exchangeType: 'life',
    targetA: playerA,
    targetB: playerB,
  };
}

/**
 * Rule 701.12d: Exchange cards between zones
 * 
 * Some spells or abilities may instruct a player to exchange cards in one zone
 * with cards in a different zone. These can exchange the cards only if all the
 * cards are owned by the same player.
 */
export function exchangeZones(zoneA: string, zoneB: string): ExchangeAction {
  return {
    type: 'exchange',
    exchangeType: 'zones',
    targetA: zoneA,
    targetB: zoneB,
  };
}

/**
 * Rule 701.12g: Exchange numerical values
 * 
 * A spell or ability may instruct a player to exchange two numerical values.
 * In such an exchange, each value becomes equal to the previous value of the other.
 */
export function exchangeNumericalValues(
  valueA: string,
  valueB: string
): ExchangeAction {
  return {
    type: 'exchange',
    exchangeType: 'numerical-values',
    targetA: valueA,
    targetB: valueB,
  };
}

/**
 * Rule 701.12h: Exchange text boxes
 * 
 * One card (Exchange of Words) instructs a player to exchange the text boxes
 * of two creatures. This creates a text-changing effect.
 */
export function exchangeTextBoxes(creatureA: string, creatureB: string): ExchangeAction {
  return {
    type: 'exchange',
    exchangeType: 'text-boxes',
    targetA: creatureA,
    targetB: creatureB,
  };
}
