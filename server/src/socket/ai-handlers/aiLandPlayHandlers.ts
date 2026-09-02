/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: shock/bounce land helpers, executeAIPlayLand, handleBounceLandETB.
 *
 * Public entry symbols: executeAIPlayLand, handleBounceLandETB.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { movePermanentToHand } from "../../state/modules/zones.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { ensureGame } from "../util.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import type { AISupportedCardSourceZone } from "./aiActionCandidateTypes.js";
import { permanentHasLeaveBattlefieldExileReplacement } from "./aiDeckProfileHandlers.js";
import { getAIManaProductionOptions } from "./aiManaCostHelpers.js";
import { canChooseShockLandPayLife } from "../land-helpers.js";

function getAISourceCards(game: any, playerId: PlayerID, sourceZone: AISupportedCardSourceZone): any[] {
  return getAIHandlerDeps().getAISourceCards(game, playerId, sourceZone);
}

function applyAISelectedLandFace(card: any, selectedFaceIndex?: number): void {
  getAIHandlerDeps().applyAISelectedLandFace(card, selectedFaceIndex);
}

async function requestAISharedLandPlay(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  request: { cardId: string; sourceZone: AISupportedCardSourceZone; selectedFaceIndex?: number },
): Promise<boolean> {
  return getAIHandlerDeps().requestAISharedLandPlay(io, gameId, playerId, request);
}

/**
 * List of shock lands and similar "pay life or enter tapped" lands
 */
const SHOCK_LANDS = new Set([
  "blood crypt", "breeding pool", "godless shrine", "hallowed fountain",
  "overgrown tomb", "sacred foundry", "steam vents", "stomping ground",
  "temple garden", "watery grave"
]);

/**
 * List of bounce lands (karoo lands / aqueducts) that return a land to hand
 * These tap for 2 mana of different colors and enter tapped
 */
const BOUNCE_LANDS = new Set([
  // Ravnica bounce lands
  "azorius chancery", "boros garrison", "dimir aqueduct", "golgari rot farm",
  "gruul turf", "izzet boilerworks", "orzhov basilica", "rakdos carnarium",
  "selesnya sanctuary", "simic growth chamber",
  // Commander/other bounce lands
  "coral atoll", "dormant volcano", "everglades", "jungle basin", "karoo",
  // Moonring/other variants
  "guildless commons"
]);

/**
 * Check if a land is a bounce land (returns a land to hand when it enters)
 */
function isBounceLand(cardName: string): boolean {
  return BOUNCE_LANDS.has((cardName || '').toLowerCase().trim());
}

/**
 * Check if a land always enters tapped (tap lands, temples, bounce lands, etc.)
 */
function landEntersTapped(card: any): boolean {
  const oracleText = (card?.oracle_text || '').toLowerCase();
  const cardName = (card?.name || '').toLowerCase();
  
  // Bounce lands always enter tapped
  if (isBounceLand(cardName)) {
    return true;
  }
  
  // Check for explicit "enters the battlefield tapped" without conditions
  if ((oracleText.includes('enters the battlefield tapped') || oracleText.includes('enters tapped')) && 
      !oracleText.includes('unless') && 
      !oracleText.includes('you may pay')) {
    return true;
  }
  
  // Known tapped lands (temples, gain lands, etc.)
  const knownTappedLands = [
    'temple of', 'guildgate', 'refuge', 'life-gain land',
    'thriving', 'vivid', 'transguild promenade', 'rupture spire'
  ];
  if (knownTappedLands.some(pattern => cardName.includes(pattern))) {
    return true;
  }
  
  return false;
}

/**
 * Check if a land is a shock land (can pay 2 life to enter untapped)
 */
function isShockLand(cardName: string): boolean {
  return SHOCK_LANDS.has((cardName || '').toLowerCase().trim());
}

/**
 * Check if AI should pay 2 life for a shock land to enter untapped
 * Generally, AI should pay life if:
 * - Life is above 10
 * - Or if this is the only land that can produce a needed color this turn
 */
function shouldAIPayShockLandLife(game: any, playerId: PlayerID): boolean {
  if (!canChooseShockLandPayLife(game, String(playerId), 2)) {
    return false;
  }

  // Get current life total
  const players = game.state?.players || [];
  const player = players.find((p: any) => p.id === playerId);
  const currentLife = player?.life ?? 40;
  
  // If life is comfortably above 10, pay the life for tempo
  // In Commander starting at 40 life, 2 life is worth the untapped land
  if (currentLife > 10) {
    return true;
  }
  
  // If life is low, enter tapped to preserve life
  return false;
}


/**
 * Execute AI playing a land
 */
export async function executeAIPlayLand(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  cardId: string,
  sourceZone: AISupportedCardSourceZone = 'hand',
  selectedFaceIndex?: number,
): Promise<boolean> {
  const game = ensureGame(gameId);
  if (!game) return false;
  
  debug(1, '[AI] Playing land:', { gameId, playerId, cardId, sourceZone, selectedFaceIndex });
  
  try {
    const sourceCards = getAISourceCards(game, playerId, sourceZone);
    const cardToPlay = sourceCards.find((c: any) => c?.id === cardId) || null;

    if (!cardToPlay) {
      debugWarn(1, '[AI] Land not found in AI source zone:', { gameId, playerId, cardId, sourceZone });
      return false;
    }

    if (sourceZone === 'library' && String(sourceCards[0]?.id || '') !== cardId) {
      debugWarn(1, '[AI] Refusing to play a non-top library card as a land:', { gameId, playerId, cardId });
      return false;
    }

    applyAISelectedLandFace(cardToPlay, selectedFaceIndex);

    return requestAISharedLandPlay(io, gameId, playerId, {
      cardId,
      sourceZone,
      selectedFaceIndex,
    });
    
  } catch (error) {
    debugError(1, '[AI] Error playing land:', error);
    return false;
  }
}

/**
 * Handle bounce land ETB trigger - AI must return a land to hand
 * AI prefers to return:
 * 1. Basic lands (least valuable)
 * 2. Tapped lands
 * 3. Lands that don't produce needed colors
 */
/**
 * Handle AI automatic bounce land choice
 * Called when a bounce land ETB trigger resolves for an AI player
 */
export async function handleBounceLandETB(game: any, playerId: PlayerID, bounceLandName: string): Promise<void> {
  // Ensure battlefield exists on game state
  game.state = (game.state || {}) as any;
  game.state.battlefield = game.state.battlefield || [];
  const battlefield = game.state.battlefield;
  
  // Find all lands controlled by this player, INCLUDING the bounce land itself.
  // Per MTG rules, the bounce land can return itself to hand.
  // This is important for turn 1 scenarios where it's the only land you control.
  const controlledLands = battlefield.filter((perm: any) => {
    if (perm.controller !== playerId) return false;
    const typeLine = (perm.card?.type_line || '').toLowerCase();
    return typeLine.includes('land');
  });
  
  if (controlledLands.length === 0) {
    // No lands at all - shouldn't happen normally, but handle gracefully
    debug(1, '[AI] No lands to return for bounce land');
    return;
  }
  
  // Check if the player has landfall permanents on the battlefield
  // If so, returning lands can be beneficial for replaying them
  const hasLandfallSynergy = battlefield.some((perm: any) => {
    if (perm.controller !== playerId) return false;
    const oracleText = (perm.card?.oracle_text || '').toLowerCase();
    // Check for landfall keyword or "whenever a land enters"
    return oracleText.includes('landfall') || 
           oracleText.includes('whenever a land enters') ||
           oracleText.includes('whenever you play a land');
  });
  
  // Score lands to determine which to return (lower score = return first)
  const scoredLands = controlledLands.map((perm: any) => {
    let score = 50; // Base score
    const card = perm.card;
    const typeLine = (card?.type_line || '').toLowerCase();
    const permName = (card?.name || '').toLowerCase();
    
    // The bounce land itself - moderate penalty (can return it if no other options)
    if (permName === bounceLandName.toLowerCase()) {
      // If it's the only land, we must return it
      if (controlledLands.length === 1) {
        score = 0; // Only option
      } else {
        // Prefer to return other lands unless landfall is a factor
        // Bounce lands enter tapped, so returning it means we can replay it (still tapped though)
        score += hasLandfallSynergy ? 10 : 30;
        // Apply tapped bonus if applicable (bounce lands are always tapped when they ETB)
        if (perm.tapped) {
          score -= 10;
        }
      }
      if (permanentHasLeaveBattlefieldExileReplacement(perm)) {
        score += 10000;
      }
      return { perm, score };
    }
    
    // Basic lands are least valuable (return first)
    if (typeLine.includes('basic')) {
      score -= 30;
      // But if we have landfall, returning basics to replay is good!
      if (hasLandfallSynergy) {
        score -= 10; // Even more incentive to return basics for landfall
      }
    }
    
    // Tapped lands are good to return (can replay untapped later potentially)
    if (perm.tapped) {
      score -= 10;
    }
    
    // Lands that only produce colorless are less valuable
    const producedColors = getAIManaProductionOptions(game, playerId, perm);
    
    if (producedColors.length === 1 && producedColors[0] === 'C') {
      score -= 5;
    }
    
    // Don't return lands that produce multiple colors (they're valuable)
    if (producedColors.length > 2) {
      score += 20;
    }

    if (permanentHasLeaveBattlefieldExileReplacement(perm)) {
      score += 10000;
    }
    
    return { perm, score };
  });
  
  // Sort by score (lowest first = return first)
  scoredLands.sort((a: any, b: any) => a.score - b.score);
  
  // Return the lowest-scored land to hand
  const landToReturn = scoredLands[0]?.perm;
  if (landToReturn) {
    movePermanentToHand(game as any, String(landToReturn.id || ''));
    debug(1, '[AI] Bounce land returned to hand:', landToReturn.card?.name, hasLandfallSynergy ? '(landfall synergy detected)' : '');
  }
}
