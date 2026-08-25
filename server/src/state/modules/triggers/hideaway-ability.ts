/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover HideawayAbility detector (ETB just-in-time helper)
 * Public: HideawayAbility, detectHideawayAbility
 */

// ============================================================================
// Hideaway Support
// ============================================================================

/**
 * Hideaway - When this land enters, look at the top X cards of your library,
 * exile one face down, then put the rest on the bottom. When condition is met,
 * you may play the exiled card without paying its mana cost.
 * 
 * Original hideaway lands (hideaway 4):
 * - Mosswort Bridge (creatures with total power 10+)
 * - Windbrisk Heights (attacked with 3+ creatures)
 * - Shelldock Isle (library has 20 or fewer cards)
 * - Howltooth Hollow (each player has no cards in hand)
 * - Spinerock Knoll (dealt 7+ damage this turn)
 * 
 * Newer hideaway cards:
 * - Watcher for Tomorrow (hideaway 4, when it leaves)
 * - Hideaway lands in Streets of New Capenna
 */
export interface HideawayAbility {
  hideawayCount: number;  // How many cards to look at
  condition: string;
  permanentId: string;
  exiledCardId?: string;
}

export function detectHideawayAbility(card: any): HideawayAbility | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const keywords = card?.keywords || [];
  
  // Check for hideaway keyword
  const hasHideaway = keywords.some((k: string) => k.toLowerCase().includes('hideaway'));
  
  if (!hasHideaway && !oracleText.includes('hideaway')) {
    return null;
  }
  
  // Parse hideaway count - "hideaway 4" or "hideaway 5"
  const hideawayMatch = oracleText.match(/hideaway\s*(\d+)?/i);
  const hideawayCount = hideawayMatch && hideawayMatch[1] ? parseInt(hideawayMatch[1], 10) : 4;
  
  // Extract condition for playing the exiled card
  let condition = "unknown";
  const hasPattern = (pattern: RegExp) => pattern.test(oracleText);
  
  // Mosswort Bridge pattern
  if (
    hasPattern(/creatures with total power 10 or greater/i) ||
    hasPattern(/creatures you control have total power 10 or greater/i)
  ) {
    condition = "Control creatures with total power 10+";
  }
  // Windbrisk Heights pattern
  else if (hasPattern(/attacked with (three|3) or more creatures(?: this turn)?/i)) {
    condition = "Attacked with 3+ creatures this turn";
  }
  // Shelldock Isle pattern
  else if (hasPattern(/(?:a )?library has (twenty|20) or fewer cards(?: in it)?/i)) {
    condition = "A library has 20 or fewer cards";
  }
  // Howltooth Hollow pattern
  else if (hasPattern(/each player has no cards in hand/i)) {
    condition = "Each player has no cards in hand";
  }
  // Spinerock Knoll pattern
  else if (hasPattern(/(?:an )?opponent was dealt (7|seven) or more damage(?: this turn)?/i)) {
    condition = "An opponent was dealt 7+ damage this turn";
  }
  
  return {
    hideawayCount,
    condition,
    permanentId: '',  // Will be set when the permanent enters
  };
}
