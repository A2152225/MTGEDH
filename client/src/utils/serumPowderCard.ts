/**
 * Detect Serum Powder (and functionally identical cards) in a player's hand
 * so the mulligan dialog can offer the optional exile-and-redraw action.
 */
const SERUM_RE =
  /any time you could mulligan and this card is in your hand, you may exile all the cards from your hand, then draw that many cards/i;

export function readCardOracleText(card: any): string {
  const rec = card?.card || card || {};
  return String(rec.oracle_text || rec.oracleText || card?.oracle_text || '').replace(/\u2019/g, "'");
}

export function isSerumPowderCard(card: any): boolean {
  if (!card) return false;
  const name = String(card?.name || card?.card?.name || '').trim().toLowerCase();
  if (name === 'serum powder') return true;
  return SERUM_RE.test(readCardOracleText(card));
}

export function findSerumPowderCardsInHand(hand: any[] | undefined | null): any[] {
  return (Array.isArray(hand) ? hand : []).filter((card) => isSerumPowderCard(card));
}
