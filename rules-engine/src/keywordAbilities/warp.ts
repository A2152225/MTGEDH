/**
 * Warp keyword ability (Rule 702.185)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.185. Warp
 * 702.185a Warp represents two static abilities that function while the card with warp is on the 
 * stack, one of which may create a delayed triggered ability. "Warp [cost]" means "You may cast 
 * this card from your hand by paying [cost] rather than its mana cost" and "If this spell's warp 
 * cost was paid, exile the permanent this spell becomes at the beginning of the next end step. Its 
 * owner may cast this card after the current turn has ended for as long as it remains exiled."
 * 702.185b Some effects refer to "warped" cards in exile. A warped card in exile is one that was 
 * exiled by the delayed triggered ability created by a warp ability.
 * 702.185c Some effects refer to whether "a spell was warped this turn." This means that a spell 
 * was cast for its warp cost this turn.
 */

export interface WarpAbility {
  readonly type: 'warp';
  readonly source: string;
  readonly warpCost: string;
  readonly wasWarped: boolean;
  readonly isWarped: boolean; // In exile as warped card
  readonly canCastFromExile: boolean;
  readonly exiledOnTurn?: number;
}

/**
 * Create a warp ability
 * Rule 702.185a
 * @param source - The card with warp
 * @param warpCost - Alternative cost
 * @returns Warp ability object
 */
export function warp(source: string, warpCost: string): WarpAbility {
  return {
    type: 'warp',
    source,
    warpCost,
    wasWarped: false,
    isWarped: false,
    canCastFromExile: false,
  };
}

function normalizeZone(zone: string): string {
  return String(zone || '').trim().toLowerCase();
}

function extractKeywordCost(oracleText: string, keyword: string): string | null {
  const normalized = String(oracleText || '').replace(/\r?\n/g, ' ');
  const pattern = new RegExp(`\\b${keyword}\\s+([^.;,()]+)`, 'i');
  const match = normalized.match(pattern);
  if (!match) {
    return null;
  }

  const cost = String(match[1] || '').trim();
  return cost || null;
}

/**
 * Cast with warp cost
 * Rule 702.185a - Alternative cost
 * @param ability - Warp ability
 * @returns Updated ability
 */
export function castWarped(ability: WarpAbility): WarpAbility {
  return {
    ...ability,
    wasWarped: true,
  };
}

/**
 * Check if the spell can be cast from hand using warp.
 * Rule 702.185a
 */
export function canCastWithWarp(zone: string): boolean {
  return normalizeZone(zone) === 'hand';
}

/**
 * Exile permanent as warped card
 * Rule 702.185a - Delayed trigger at end step
 * @param ability - Warp ability
 * @returns Updated ability
 */
export function exileWarped(ability: WarpAbility, currentTurn?: number): WarpAbility {
  return {
    ...ability,
    isWarped: true,
    canCastFromExile: true,
    exiledOnTurn: Number.isFinite(currentTurn) ? Number(currentTurn) : ability.exiledOnTurn,
  };
}

/**
 * Check whether a warped exiled card can be cast again.
 * Rule 702.185a
 */
export function canCastWarpedFromExile(ability: WarpAbility, currentTurn?: number): boolean {
  if (!ability.isWarped || !ability.canCastFromExile) {
    return false;
  }

  if (!Number.isFinite(currentTurn) || !Number.isFinite(ability.exiledOnTurn)) {
    return true;
  }

  return Number(currentTurn) > Number(ability.exiledOnTurn);
}

/**
 * Check if spell was warped
 * Rule 702.185c
 * @param ability - Warp ability
 * @returns True if warped
 */
export function wasWarpedThisTurn(ability: WarpAbility): boolean {
  return ability.wasWarped;
}

/**
 * Check if card is warped in exile
 * Rule 702.185b
 * @param ability - Warp ability
 * @returns True if warped in exile
 */
export function isWarpedInExile(ability: WarpAbility): boolean {
  return ability.isWarped;
}

/**
 * Parse a warp cost from oracle text.
 */
export function parseWarpCost(oracleText: string): string | null {
  return extractKeywordCost(oracleText, 'warp');
}

/**
 * Multiple instances of warp are not redundant
 * @param abilities - Array of warp abilities
 * @returns False
 */
export function hasRedundantWarp(abilities: readonly WarpAbility[]): boolean {
  return false;
}
