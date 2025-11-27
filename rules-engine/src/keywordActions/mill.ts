/**
 * Rule 701.17: Mill
 * 
 * For a player to mill a number of cards, that player puts that many cards from
 * the top of their library into their graveyard.
 * 
 * Reference: Rule 701.17
 */

export interface MillAction {
  readonly type: 'mill';
  readonly playerId: string;
  readonly count: number;
}

/**
 * Rule 701.17a: Mill cards from library to graveyard
 * 
 * For a player to mill a number of cards, that player puts that many cards from
 * the top of their library into their graveyard.
 */
export function millCards(playerId: string, count: number): MillAction {
  return {
    type: 'mill',
    playerId,
    count,
  };
}

/**
 * Rule 701.17b: Can't mill more than library size
 * 
 * A player can't mill a number of cards greater than the number of cards in
 * their library. If given the choice to do so, they can't choose to take that
 * action. If instructed to do so, they mill as many as possible.
 */
export function canMillCount(librarySize: number, requestedCount: number): boolean {
  return requestedCount <= librarySize;
}

export function getActualMillCount(
  librarySize: number,
  requestedCount: number
): number {
  return Math.min(librarySize, requestedCount);
}

/**
 * Rule 701.17c: Finding milled cards
 * 
 * An effect that refers to a milled card can find that card in the zone it moved
 * to from the library, as long as that zone is a public zone.
 */
export function canFindMilledCard(destinationZone: string): boolean {
  // Public zones: battlefield, graveyard, exile (face-up), stack
  const publicZones = ['battlefield', 'graveyard', 'exile', 'stack'];
  return publicZones.includes(destinationZone);
}

/**
 * Rule 701.17d: Multiple milled cards
 * 
 * If an ability checks information about a single milled card but more than one
 * card was milled, that ability refers to each of the milled cards. If that
 * ability asks for any information about the milled card, such as a characteristic
 * or mana value, it gets multiple answers. If these answers are used to determine
 * the value of a variable, the sum of the answers is used.
 */
export interface MillResult {
  readonly playerId: string;
  readonly milledCards: readonly string[];
  readonly destinationZone: string;
}

export function createMillResult(
  playerId: string,
  milledCards: readonly string[],
  destinationZone: string = 'graveyard'
): MillResult {
  return {
    playerId,
    milledCards,
    destinationZone,
  };
}

/**
 * Parsed mill effect from oracle text
 */
export interface ParsedMillEffect {
  readonly type: 'mill';
  readonly count: number;
  readonly targetType: 'player' | 'self' | 'opponent' | 'each' | 'each-opponent';
  readonly requiresTarget: boolean;
}

/**
 * Word to number mapping for parsing
 */
const WORD_TO_NUMBER: Record<string, number> = {
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
  'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  'eleven': 11, 'twelve': 12, 'thirteen': 13,
  'a': 1, 'an': 1,
};

/**
 * Parse a number from text (supports both numeric and word forms)
 */
function parseNumber(text: string): number {
  const lower = text.toLowerCase().trim();
  if (WORD_TO_NUMBER[lower] !== undefined) {
    return WORD_TO_NUMBER[lower];
  }
  const num = parseInt(text, 10);
  return isNaN(num) ? 1 : num;
}

/**
 * Parse mill effects from oracle text
 * 
 * Patterns matched:
 * - "Target player mills X cards" / "target player puts the top X cards of their library into their graveyard"
 * - "Each player mills X cards"
 * - "Each opponent mills X cards"
 * - "Target opponent mills X cards"
 * - "Mill X cards" (self-mill)
 * - "You mill X cards"
 * 
 * @param oracleText The oracle text to parse
 * @returns Parsed mill effect or null if no mill effect found
 */
export function parseMillFromOracleText(oracleText: string): ParsedMillEffect | null {
  const lower = oracleText.toLowerCase();
  
  // Pattern: "target player mills X cards" or "target player puts the top X cards...into...graveyard"
  const targetPlayerMillMatch = lower.match(
    /target\s+player\s+(?:mills?\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)|puts?\s+the\s+top\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?\s+.*(?:into|in)\s+(?:their|his or her)\s+graveyard)/i
  );
  if (targetPlayerMillMatch) {
    const numStr = targetPlayerMillMatch[1] || targetPlayerMillMatch[2];
    const count = parseNumber(numStr);
    return { type: 'mill', count, targetType: 'player', requiresTarget: true };
  }
  
  // Pattern: "target opponent mills X cards"
  const targetOpponentMillMatch = lower.match(
    /target\s+opponent\s+mills?\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i
  );
  if (targetOpponentMillMatch) {
    const count = parseNumber(targetOpponentMillMatch[1]);
    return { type: 'mill', count, targetType: 'opponent', requiresTarget: true };
  }
  
  // Pattern: "each opponent mills X cards"
  const eachOpponentMillMatch = lower.match(
    /each\s+opponent\s+mills?\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i
  );
  if (eachOpponentMillMatch) {
    const count = parseNumber(eachOpponentMillMatch[1]);
    return { type: 'mill', count, targetType: 'each-opponent', requiresTarget: false };
  }
  
  // Pattern: "each player mills X cards"
  const eachPlayerMillMatch = lower.match(
    /each\s+player\s+mills?\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i
  );
  if (eachPlayerMillMatch) {
    const count = parseNumber(eachPlayerMillMatch[1]);
    return { type: 'mill', count, targetType: 'each', requiresTarget: false };
  }
  
  // Pattern: self mill - "mill X cards" without target, or "you mill X cards"
  // Be careful not to match "target player mills" here
  if (!lower.includes('target')) {
    const selfMillMatch = lower.match(
      /(?:^|[.,;:]\s*)(?:you\s+)?mills?\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?/i
    );
    if (selfMillMatch) {
      const count = parseNumber(selfMillMatch[1]);
      return { type: 'mill', count, targetType: 'self', requiresTarget: false };
    }
  }
  
  return null;
}

/**
 * Check if oracle text contains a mill effect
 */
export function hasMillEffect(oracleText: string): boolean {
  return parseMillFromOracleText(oracleText) !== null;
}
