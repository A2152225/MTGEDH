/**
 * Rule 701.42: Meld
 * 
 * Meld is a keyword action that appears in an ability on one card in a meld pair.
 * To meld the two cards in a meld pair, put them onto the battlefield with their
 * back faces up and combined.
 * 
 * Reference: Rule 701.42, also see Rule 712 "Double-Faced Cards"
 */

export interface MeldAction {
  readonly type: 'meld';
  readonly cardAId: string; // First card in meld pair
  readonly cardBId: string; // Second card in meld pair
  readonly meldedPermanentId?: string; // ID of resulting melded permanent
}

export interface MeldPair {
  readonly cardA: string;
  readonly cardB: string;
  readonly meldedName: string; // Name of the melded permanent
}

/**
 * Rule 701.42a: Meld cards
 * 
 * To meld the two cards in a meld pair, put them onto the battlefield with their
 * back faces up and combined. The resulting permanent is a single object
 * represented by two cards.
 */
export function meld(cardAId: string, cardBId: string): MeldAction {
  return {
    type: 'meld',
    cardAId,
    cardBId,
  };
}

/**
 * Complete meld with resulting permanent
 */
export function completeMeld(
  cardAId: string,
  cardBId: string,
  meldedPermanentId: string
): MeldAction {
  return {
    type: 'meld',
    cardAId,
    cardBId,
    meldedPermanentId,
  };
}

/**
 * Rule 701.42b: Only meld pairs can meld
 * 
 * Only two cards belonging to the same meld pair can be melded. Tokens, cards
 * that aren't meld cards, or meld cards that don't form a meld pair can't be
 * melded.
 */
export function canMeld(
  cardA: { isMeldCard: boolean; isToken: boolean; meldPairName?: string },
  cardB: { isMeldCard: boolean; isToken: boolean; meldPairName?: string }
): boolean {
  // Can't meld tokens
  if (cardA.isToken || cardB.isToken) return false;
  
  // Both must be meld cards
  if (!cardA.isMeldCard || !cardB.isMeldCard) return false;
  
  // Must be the same meld pair
  if (cardA.meldPairName !== cardB.meldPairName) return false;
  
  return true;
}

/**
 * Rule 701.42c: Invalid meld stays in zone
 * 
 * If an effect instructs a player to meld objects that can't be melded, they
 * stay in their current zone.
 */
export function handleInvalidMeld(
  cardAZone: string,
  cardBZone: string
): { cardAStaysIn: string; cardBStaysIn: string } {
  return {
    cardAStaysIn: cardAZone,
    cardBStaysIn: cardBZone,
  };
}

/**
 * Meld result
 */
export interface MeldResult {
  readonly melded: boolean;
  readonly meldedPermanentId: string | null;
  readonly componentCardIds: readonly string[];
}

export function createMeldResult(
  melded: boolean,
  meldedPermanentId: string | null,
  cardAId: string,
  cardBId: string
): MeldResult {
  return {
    melded,
    meldedPermanentId,
    componentCardIds: [cardAId, cardBId],
  };
}

/**
 * Check if a permanent is melded
 */
export function isMeldedPermanent(componentCount: number): boolean {
  return componentCount === 2;
}

/**
 * Example meld pairs (from comprehensive rules)
 * 
 * Famous examples:
 * - Brisela, Voice of Nightmares (Bruna + Gisela)
 * - Chittering Host (Graf Rats + Midnight Scavengers)
 */
export const MELD_PAIR_EXAMPLE = {
  bruna: 'Bruna, the Fading Light',
  gisela: 'Gisela, the Broken Blade',
  brisela: 'Brisela, Voice of Nightmares',
} as const;
