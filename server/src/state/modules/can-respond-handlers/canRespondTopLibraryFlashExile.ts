// server/src/state/modules/can-respond-handlers/canRespondTopLibraryFlashExile.ts
// Origin parent: server/src/state/modules/can-respond.ts
// Cluster moved: top-of-library land/spell permission helpers, flash/instant,
// flashback, foretell/exile-cast, and playable-from-exile checks used by
// getCastableSpellCandidates and land-play.
// Public entry symbols: getTopLibraryCard, getTopLibrarySpellPermission,
// canPlayTopLibraryLand, hasFlashOrInstant, hasFlashback,
// hasForetellOrCanCastFromExile, isCardPlayableFromExile.

import type { GameContext } from '../../context.js';
import type { PlayerID } from '../../../../../shared/src/index.js';
import { debugWarn } from '../../../utils/debug.js';
import { canCastFromTop, canPlayLandsFromTop } from '../game-state-effects.js';
import { isLandTypeLine } from './canRespondSplitSecondLandPredicates.js';

export function getTopLibraryCard(ctx: GameContext, playerId: PlayerID): any | null {
  const libraries = (ctx as any).libraries;
  if (!libraries || typeof libraries.get !== 'function') {
    return null;
  }

  const library = libraries.get(playerId);
  if (!Array.isArray(library) || library.length === 0) {
    return null;
  }

  return library[0] ?? null;
}

function hasGenericTopLibraryLandPermission(ctx: GameContext, playerId: PlayerID, card?: any): boolean {
  return canPlayLandsFromTop(ctx, playerId, card).canPlay;
}

export function getTopLibrarySpellPermission(ctx: GameContext, playerId: PlayerID, card: any) {
  return canCastFromTop(ctx, playerId, card);
}

export function canPlayTopLibraryLand(ctx: GameContext, playerId: PlayerID, card: any): boolean {
  if (!card || typeof card === 'string') return false;
  if (!isLandTypeLine(card?.type_line || card?.typeLine)) return false;

  const topLandPermission = canPlayLandsFromTop(ctx, playerId, card);
  return topLandPermission.canPlay || hasGenericTopLibraryLandPermission(ctx, playerId, card);
}

function canCastTopLibrarySpell(ctx: GameContext, playerId: PlayerID, card: any): boolean {
  if (!card || typeof card === 'string') return false;

  return getTopLibrarySpellPermission(ctx, playerId, card).canCast;
}

/**
 * Check if a card has flash or is an instant
 */
export function hasFlashOrInstant(card: any): boolean {
  if (!card) return false;
  
  const typeLine = (card.type_line || "").toLowerCase();
  const oracleText = (card.oracle_text || card.oracleText || "").toLowerCase();
  
  // Check if it's an instant
  if (typeLine.includes("instant")) {
    return true;
  }
  
  // Keyword Flash only — do not match "Flashback" (substring false positive).
  if (/\bflash\b/i.test(oracleText)) {
    return true;
  }
  
  return false;
}

/**
 * Check if a card has flashback ability
 * Flashback allows casting from graveyard for an alternate cost
 */
export function hasFlashback(card: any): { hasIt: boolean; cost?: string } {
  if (!card) return { hasIt: false };
  
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check for flashback keyword
  if (!oracleText.includes("flashback")) {
    return { hasIt: false };
  }
  
  // Try to extract the flashback cost
  // Pattern: "Flashback {cost}" or "Flashback—{cost}"
  const flashbackMatch = oracleText.match(/flashback[—\s]+(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (flashbackMatch) {
    return { hasIt: true, cost: flashbackMatch[1] };
  }
  
  // If we find "flashback" but can't parse cost, log warning and assume it exists
  debugWarn(2, `[hasFlashback] Found flashback on ${card.name} but could not parse cost from: "${oracleText}"`);
  return { hasIt: true };
}

/**
 * Check if a card has foretell ability or can be cast from exile
 * Foretell allows casting from exile for an alternate cost after being foretold
 */
export function hasForetellOrCanCastFromExile(card: any): { hasIt: boolean; cost?: string } {
  if (!card) return { hasIt: false };
  
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check for foretell keyword
  if (oracleText.includes("foretell")) {
    // Try to extract foretell cost
    // Pattern: "Foretell {cost}"
    const foretellMatch = oracleText.match(/foretell\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    if (foretellMatch) {
      return { hasIt: true, cost: foretellMatch[1] };
    }
    debugWarn(2, `[hasForetellOrCanCastFromExile] Found foretell on ${card.name} but could not parse cost from: "${oracleText}"`);
    return { hasIt: true };
  }
  
  // Check for "you may cast this card from exile" or similar patterns
  if (oracleText.includes("you may cast") && oracleText.includes("from exile")) {
    return { hasIt: true };
  }
  
  // Check for "you may play" from exile
  if (oracleText.includes("you may play") && oracleText.includes("from exile")) {
    return { hasIt: true };
  }
  
  return { hasIt: false };
}

/**
 * Conservative check for unparseable alternative cost.
 * When we can't parse the cost, we assume the player might be able to pay it.
 * This prevents auto-passing when we're unsure, which is safer than auto-passing incorrectly.
 * 
 * @returns Always returns true (assumes player can pay)
 */
function assumeCanPayUnknownCost(cardName: string, mechanicName: string): boolean {
  debugWarn(2, `[assumeCanPayUnknownCost] Could not parse ${mechanicName} cost for ${cardName} - being conservative, assuming player can pay`);
  return true;
}

/**
 * Check if a card is marked as playable from exile.
 * Handles both legacy array format and object entries that may store
 * boolean flags or numeric "playable until turn" expirations.
 */
export function isCardPlayableFromExile(playableCards: any, cardId: string, currentTurn: number): boolean {
  if (!playableCards) return false;
  
  // Handle array format: ['card1', 'card2']
  if (Array.isArray(playableCards)) {
    return playableCards.includes(cardId);
  }
  
  const entry = playableCards[cardId];
  return typeof entry === 'number' ? entry >= currentTurn : Boolean(entry);
}
