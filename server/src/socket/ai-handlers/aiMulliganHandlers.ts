/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: London-mulligan thresholds, mana-source counting, and
 * handleAIMulligan keep/mulligan decision.
 *
 * Public entry symbols: handleAIMulligan.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { debug, debugError } from "../../utils/debug.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import { ensureGame } from "../util.js";
import { ensureAIDeckProfile, summarizeAIHandPlan } from "./aiDeckProfileHandlers.js";

/**
 * Mulligan thresholds
 */
const MIN_HAND_SIZE_TO_MULLIGAN = 4; // Don't mulligan to 4 or fewer cards (too risky)
const OPENING_HAND_SIZE = 7; // Standard opening hand in EDH/Commander

/**
 * Calculate the effective hand size after London Mulligan
 * In multiplayer Commander, the first mulligan is free, then you put back N-1 cards
 * where N is the number of mulligans taken (excluding the first free one)
 */
function calculateEffectiveHandSizeAfterMulligan(currentHandSize: number, mulligansTaken: number): number {
  // After mulligan, you draw 7 cards
  // Then you put back cards equal to the number of mulligans (minus 1 for the free first mulligan in multiplayer)
  // Effective mulligans = mulligansTaken (the free first mulligan is already accounted for in the game rules)
  
  // For the first mulligan (mulligansTaken = 0 -> 1), you draw 7 and keep 7 (free)
  // For the second mulligan (mulligansTaken = 1 -> 2), you draw 7 and put back 1 (keep 6)
  // For the third mulligan (mulligansTaken = 2 -> 3), you draw 7 and put back 2 (keep 5)
  
  const nextMulliganCount = mulligansTaken + 1;
  const cardsToBottom = Math.max(0, nextMulliganCount - 1); // First mulligan is free
  return 7 - cardsToBottom;
}

/**
 * Check if a card is a mana source (mana rock or mana dork)
 */
function isManaSource(card: any): boolean {
  const typeLine = (card?.type_line || '').toLowerCase();
  const oracleText = (card?.oracle_text || '').toLowerCase();
  const cardName = (card?.name || '').toLowerCase();
  
  // Don't count lands as mana sources here - we track those separately
  if (typeLine.includes('land')) return false;
  
  // Check for mana rocks (artifacts with tap: add mana)
  if (typeLine.includes('artifact') && oracleText.includes('{t}') && oracleText.includes('add')) {
    return true;
  }
  
  // Check for mana dorks (creatures with tap: add mana)
  if (typeLine.includes('creature') && oracleText.includes('{t}') && oracleText.includes('add')) {
    return true;
  }
  
  // Known mana rocks
  const knownManaRocks = [
    'sol ring', 'mana crypt', 'mana vault', 'arcane signet', 'mind stone',
    'fellwar stone', 'thought vessel', 'commander\'s sphere', 'chromatic lantern',
    'signet', 'talisman'
  ];
  if (knownManaRocks.some(name => cardName.includes(name))) return true;
  
  // Known mana dorks
  const knownManaDorks = [
    'llanowar elves', 'elvish mystic', 'birds of paradise', 'noble hierarch',
    'deathrite shaman', 'avacyn\'s pilgrim', 'elves of deep shadow',
    'bloom tender', 'priest of titania', 'elvish archdruid', 'fyndhorn elves',
    'boreal druid', 'arbor elf'
  ];
  if (knownManaDorks.some(name => cardName.includes(name))) return true;
  
  return false;
}

/**
 * Handle AI mulligan decision
 * 
 * Key considerations:
 * - London Mulligan: After mulliganing, you draw 7 and put back N cards (where N = mulligans taken - 1 for free first)
 * - The cost of mulliganing increases significantly with each mulligan
 * - Need to balance having enough lands vs keeping enough cards
 * 
 * AI should mulligan if:
 * - Hand has 0 lands (unplayable)
 * - Hand has 1 land without mana acceleration (too risky)
 * - Hand has all lands and no spells (unlikely to win)
 * - Hand is severely imbalanced (6+ lands in opening hand)
 * 
 * AI should keep if:
 * - Hand has 3+ lands (good mana base)
 * - Hand has 2 lands with mana rocks/dorks (can accelerate)
 * - Effective hand size after next mulligan would be too small (4 or fewer)
 * - Current hand has playable cards even if not ideal
 */
export async function handleAIMulligan(
  io: Server,
  gameId: string,
  playerId: PlayerID
): Promise<boolean> {
  const { isAIPlayer } = getAIHandlerDeps();
  if (!isAIPlayer(gameId, playerId)) {
    return false;
  }
  
  const game = ensureGame(gameId);
  if (!game || !game.state) {
    return false;
  }
  
  debug(1, '[AI] AI making mulligan decision:', { gameId, playerId });
  
  try {
    // Get the AI's current hand and mulligan state
    const zones = game.state.zones?.[playerId];
    const hand = Array.isArray(zones?.hand) ? zones.hand : [];
    
    if (hand.length === 0) {
      debug(1, '[AI] Empty hand, keeping by default');
      return true; // Empty hand, nothing to mulligan
    }
    
    // Get current mulligan count
    const mulliganState = (game.state as any).mulliganState || {};
    const aiMulliganState = mulliganState[playerId];
    const currentMulligans = aiMulliganState?.mulligansTaken || 0;
    const profile = ensureAIDeckProfile(game, playerId);
    
    // Calculate what hand size we'd have after the next mulligan (London Mulligan rule)
    const effectiveHandSizeAfterMulligan = calculateEffectiveHandSizeAfterMulligan(hand.length, currentMulligans);
    
    // Analyze hand composition
    let landCount = 0;
    let manaSourceCount = 0;
    let lowCostSpellCount = 0; // CMC <= 2
    let midCostSpellCount = 0; // CMC 3-4
    let highCostSpellCount = 0; // CMC >= 5
    
    for (const card of hand) {
      // Handle both object cards and string references
      const cardObj = typeof card === 'string' ? null : card;
      if (!cardObj) continue;
      
      const typeLine = (cardObj?.type_line || '').toLowerCase();
      if (typeLine.includes('land')) {
        landCount++;
      } else {
        // Check if it's a mana source (rock or dork)
        if (isManaSource(cardObj)) {
          manaSourceCount++;
        }
        
        // Categorize by CMC
        const cmc = (cardObj as any)?.cmc || 0;
        if (cmc <= 2) {
          lowCostSpellCount++;
        } else if (cmc <= 4) {
          midCostSpellCount++;
        } else {
          highCostSpellCount++;
        }
      }
    }
    
    const handSize = hand.length;
    const nonLandCount = hand.length - landCount;
    const totalManaProduction = landCount + manaSourceCount; // Effective mana sources
    const handPlan = summarizeAIHandPlan(hand, profile);
    
    debug(1, '[AI] Mulligan analysis:', {
      gameId,
      playerId,
      handSize,
      currentMulligans,
      effectiveHandSizeAfterMulligan,
      landCount,
      manaSourceCount,
      totalManaProduction,
      lowCostSpellCount,
      midCostSpellCount,
      highCostSpellCount,
      primaryArchetypes: profile?.primaryArchetypes || [],
      themedCards: handPlan.themedCards,
      synergyPairs: handPlan.synergyPairs,
      strongestPair: handPlan.strongestPair,
      comboPieces: handPlan.comboPieces,
    });
    
    // Rule 1: If next mulligan would leave us with 4 or fewer cards, be very conservative
    // Only mulligan truly unplayable hands (0 lands or all lands)
    if (effectiveHandSizeAfterMulligan <= MIN_HAND_SIZE_TO_MULLIGAN) {
      debug(1, `[AI] Next mulligan would result in ${effectiveHandSizeAfterMulligan} cards - being conservative`);
      
      // Only mulligan if truly unplayable
      if (landCount === 0) {
        debug(1, '[AI] Zero lands with small hand after mulligan - still mulliganing (unplayable)');
        return false;
      }
      
      if (nonLandCount === 0) {
        debug(1, '[AI] All lands with small hand after mulligan - still mulliganing (no spells)');
        return false;
      }
      
      // Otherwise keep - even 1 land is better than going to 4 cards
      debug(1, '[AI] Hand is playable, keeping to avoid going to 4 or fewer cards');
      return true;
    }
    
    // Rule 2: Mulligan if zero lands (unplayable hand)
    if (landCount === 0) {
      debug(1, '[AI] Zero lands in hand, mulliganing');
      return false; // Mulligan
    }
    
    // Rule 3: Mulligan if all lands and no spells (unlikely to win)
    if (nonLandCount === 0) {
      debug(1, '[AI] All lands in hand, mulliganing');
      return false; // Mulligan
    }
    
    // Rule 4: If only 1 land, check for mana acceleration and hand size considerations
    if (landCount === 1) {
      // With mana rocks/dorks AND low-cost spells, 1 land might be playable
      // BUT: Consider the effective hand size after mulligan
      if (manaSourceCount >= 1 && lowCostSpellCount >= 1) {
        // Check if we'd still have a reasonable hand size after mulligan
        if (effectiveHandSizeAfterMulligan >= 6) {
          debug(1, '[AI] 1 land but has mana acceleration and low-cost spells, and mulligan cost is low, keeping');
          return true; // Keep - can play mana rock/dork turn 1-2
        } else {
          // Hand size after mulligan would be 5 or less - 1 land is risky
          debug(1, '[AI] 1 land with acceleration but mulligan cost is high - still too risky, mulliganing');
          return false;
        }
      }
      if (handPlan.strongestPair >= 9 && manaSourceCount >= 1 && effectiveHandSizeAfterMulligan >= 6) {
        debug(1, '[AI] 1 land hand has strong internal synergy plus acceleration, keeping');
        return true;
      }
      debug(1, '[AI] Only 1 land without sufficient mana acceleration, mulliganing');
      return false; // Mulligan
    }
    
    // Rule 5: If 2 lands, evaluate playability and mulligan cost
    if (landCount === 2) {
      // 2 lands is borderline - check if hand is playable and consider mulligan cost
      
      // If effective hand size after mulligan would be 5 or less, be conservative
      if (effectiveHandSizeAfterMulligan <= 5) {
        debug(1, '[AI] 2 lands with high mulligan cost (would go to 5 or fewer), keeping');
        return true;
      }
      
      // With 6+ cards after mulligan, we can be pickier
      // Keep if we have:
      // - A mana rock/dork (gives us 3 mana on turn 3)
      // - Multiple low-cost spells we can cast
      
      if (manaSourceCount >= 1) {
        debug(1, '[AI] 2 lands with mana acceleration, keeping');
        return true; // Keep - 2 lands + rock/dork is playable
      }

      if (handPlan.strongestPair >= 8 || handPlan.themedCards >= 3 || handPlan.comboPieces >= 1) {
        debug(1, '[AI] 2 lands with strong deck-theme synergy, keeping');
        return true;
      }
      
      if (lowCostSpellCount >= 2) {
        debug(1, '[AI] 2 lands with multiple low-cost spells, keeping');
        return true; // Keep - can play early spells
      }
      
      // 2 lands with mostly high-cost spells is risky in a 7-card hand with low mulligan cost
      if (handSize === OPENING_HAND_SIZE && effectiveHandSizeAfterMulligan >= 6 && 
          highCostSpellCount >= 3 && lowCostSpellCount === 0) {
        debug(1, '[AI] 2 lands with mostly high-cost spells in opening hand, mulliganing');
        return false; // Mulligan - hand is too slow
      }
      
      // Otherwise keep 2 lands
      debug(1, '[AI] 2 lands, keeping');
      return true;
    }
    
    // Rule 6: Keep hands with 3-5 lands (good mana ratio)
    if (landCount >= 3 && landCount <= 5) {
      if (profile && handPlan.themedCards === 0 && highCostSpellCount >= 4 && effectiveHandSizeAfterMulligan >= 6) {
        debug(1, '[AI] 3-5 lands but hand is off-plan and top-heavy, mulliganing');
        return false;
      }
      debug(1, '[AI] Hand has good land count (3-5 lands), keeping');
      return true;
    }
    
    // Rule 7: Mulligan hands with 6+ lands in opening hand (too flooded)
    // BUT: Only if the mulligan cost is reasonable (would still have 6+ cards)
    if (landCount >= 6 && handSize === OPENING_HAND_SIZE && effectiveHandSizeAfterMulligan >= 6) {
      debug(1, '[AI] 6+ lands in opening hand with reasonable mulligan cost, mulliganing');
      return false; // Mulligan
    }
    
    // If we have 6+ lands but mulligan cost is high, keep it
    if (landCount >= 6) {
      debug(1, '[AI] 6+ lands but mulligan cost too high, keeping');
      return true;
    }
    
    // Default: keep hand
    debug(1, '[AI] Hand evaluation complete, keeping');
    return true;
    
  } catch (error) {
    debugError(1, '[AI] Error making mulligan decision:', error);
    return true; // Default to keeping hand on error
  }
}

