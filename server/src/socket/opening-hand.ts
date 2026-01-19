// server/src/socket/opening-hand.ts
// Socket handlers for opening hand actions (Leylines, Chancellor effects)

import type { Server, Socket } from "socket.io";
import { debugError } from "../utils/debug.js";
import { ResolutionQueueManager } from "../state/resolution/ResolutionQueueManager.js";
import { ResolutionStepType } from "../state/resolution/types.js";

/**
 * Check if a card has a Leyline-style opening hand ability
 * 
 * MTG rules: "If ~ is in your opening hand, you may begin the game with it on the battlefield."
 * This matches cards like Leyline of the Void, Leyline of Sanctity, etc.
 * 
 * Also matches Gemstone Caverns: "If ~ is in your opening hand and you're not playing first,
 * you may begin the game with ~ on the battlefield..."
 */
function isLeylineCard(card: any): boolean {
  const oracleText = ((card?.oracle_text) || '').toLowerCase();
  const cardName = ((card?.name) || '').toLowerCase();
  
  // Check for the specific Leyline ability text pattern
  // "If ~ is in your opening hand, you may begin the game with it on the battlefield."
  const hasLeylineAbility = (
    oracleText.includes('in your opening hand') &&
    (oracleText.includes('begin the game with') || oracleText.includes('begin the game with it on the battlefield'))
  );
  
  // Also match by card name for known Leylines (as a backup)
  const isKnownLeyline = cardName.startsWith('leyline of') || cardName === 'gemstone caverns';
  
  return hasLeylineAbility || isKnownLeyline;
}

/**
 * Find all Leyline cards in a player's hand
 */
function findLeylineCards(hand: any[]): any[] {
  return hand.filter(card => card && isLeylineCard(card));
}

export function registerOpeningHandHandlers(io: Server, socket: Socket) {
  // Legacy opening-hand socket handlers removed.
  // Opening hand actions are now driven via the Unified Resolution Queue.
}

/**
 * Check if a player has Leyline cards and should be prompted for opening hand actions
 * Call this after the player keeps their hand
 */
export function checkAndPromptOpeningHandActions(
  io: Server,
  game: any,
  gameId: string,
  playerId: string
): boolean {
  try {
    const zones = game.state?.zones?.[playerId];
    if (!zones || !Array.isArray(zones.hand)) {
      return false;
    }

    const hand = zones.hand;
    const leylineCards = findLeylineCards(hand);

    if (leylineCards.length > 0) {
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, playerId as any)
        .find((s: any) => s?.type === ResolutionStepType.OPENING_HAND_ACTIONS);

      if (!existing) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPENING_HAND_ACTIONS,
          playerId: playerId as any,
          sourceName: 'Opening Hand Actions',
          description: 'You may begin the game with some of these cards on the battlefield.',
          mandatory: false,
          leylineCount: leylineCards.length,
        } as any);
      }
      return true;
    }

    return false;
  } catch (err) {
    debugError(1, `checkAndPromptOpeningHandActions error:`, err);
    return false;
  }
}

