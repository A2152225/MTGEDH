/**
 * server/src/socket/ai.ts
 * 
 * AI opponent integration for multiplayer games.
 * Handles AI player registration, decision-making, and action execution.
 * 
 * Key features:
 * - Auto-selects commander from deck based on legendary creature type
 * - Handles priority passing and turn progression
 * - Broadcasts state updates to all players
 */

import { randomBytes } from "crypto";
import type { Server, Socket } from "socket.io";
import { AIEngine, AIStrategy, AIDecisionType, type AIDecisionContext, type AIPlayerConfig } from "../../../rules-engine/src/AIEngine.js";
import { ensureGame, broadcastGame } from "./util.js";
import { appendEvent } from "../db/index.js";
import { getDeck, listDecks } from "../db/decks.js";
import { fetchCardsByExactNamesBatch, normalizeName, parseDecklist } from "../services/scryfall.js";
import type { PlayerID } from "../../../shared/src/types.js";
import { categorizeSpell, evaluateTargeting, type SpellSpec, type TargetRef } from "../rules-engine/targeting.js";
import { GameManager } from "../GameManager.js";
import { hasPendingColorChoices } from "./color-choice.js";
import { hasPendingJoinForcesOrOffers } from "./join-forces.js";
import { hasPendingCreatureTypeSelections } from "./creature-type.js";
import { getAvailableMana, parseManaCost, canPayManaCost, getTotalManaFromPool } from "../state/modules/mana-check.js";
import { ResolutionQueueManager } from "../state/resolution/ResolutionQueueManager.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";

/** AI timing delays for more natural behavior */
const AI_THINK_TIME_MS = 500;
const AI_REACTION_DELAY_MS = 300;

/** Maximum cards to retrieve when searching the entire library for commander selection */
const MAX_LIBRARY_SEARCH_LIMIT = 1000;

/** Initial hand size for commander format (7 cards) */
const INITIAL_HAND_SIZE = 7;

/** Probability that AI gives up control of optional creatures (0.3 = 30%) */
const AI_OPTIONAL_GIVE_CONTROL_PROBABILITY = 0.3;

/** Mana retention tapping strategy constants */
const MIN_UNTAPPED_LANDS_FOR_INSTANTS = 3; // Keep at least 3 lands untapped for instant-speed responses
const UNTAPPED_LAND_RATIO = 0.4; // Keep at least 40% of lands untapped

/** MTG color identity symbols */
const COLOR_IDENTITY_MAP: Record<string, string> = {
  'W': 'white',
  'U': 'blue',
  'B': 'black',
  'R': 'red',
  'G': 'green',
};

/**
 * Extract color identity from a card's mana cost and oracle text
 */
function extractColorIdentity(card: any): string[] {
  const colors = new Set<string>();
  
  // Extract from mana cost
  const manaCost = card.mana_cost || '';
  for (const colorSymbol of Object.keys(COLOR_IDENTITY_MAP)) {
    if (manaCost.includes(colorSymbol)) {
      colors.add(colorSymbol);
    }
  }
  
  // Extract from color_identity if available (Scryfall provides this)
  if (Array.isArray(card.color_identity)) {
    for (const c of card.color_identity) {
      colors.add(c);
    }
  }
  
  // Extract from oracle text (for hybrid mana and ability costs)
  const oracleText = card.oracle_text || '';
  for (const colorSymbol of Object.keys(COLOR_IDENTITY_MAP)) {
    if (oracleText.includes(`{${colorSymbol}}`)) {
      colors.add(colorSymbol);
    }
  }
  
  return Array.from(colors);
}

/**
 * Check if a card is a valid commander
 * Valid commanders include:
 * - Legendary creatures
 * - Legendary planeswalkers with "can be your commander"
 * - Legendary Vehicles (as of recent rules changes)
 * - Legendary cards with Station type
 * - Background enchantments (can be commanders when paired with "Choose a Background")
 * - Any card with "can be your commander" text
 */
function isValidCommander(card: any): boolean {
  const typeLine = (card.type_line || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Background enchantments can be commanders (even if not legendary)
  if (typeLine.includes('background')) {
    return true;
  }
  
  // Must be legendary for other types
  if (!typeLine.includes('legendary')) {
    return false;
  }
  
  // Check if it's a creature
  if (typeLine.includes('creature')) {
    return true;
  }
  
  // Check if it's a Vehicle (legendary Vehicles can now be commanders)
  if (typeLine.includes('vehicle')) {
    return true;
  }
  
  // Check if it has Station type (legendary Stations can be commanders)
  if (typeLine.includes('station')) {
    return true;
  }
  
  // Check for "can be your commander" text (planeswalkers, etc.)
  if (oracleText.includes('can be your commander')) {
    return true;
  }
  
  return false;
}

/**
 * Check if a card has partner ability
 */
function hasPartner(card: any): boolean {
  const oracleText = (card.oracle_text || '').toLowerCase();
  return oracleText.includes('partner');
}

/**
 * Check if a card has background ability
 */
function hasBackground(card: any): boolean {
  const typeLine = (card.type_line || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  return typeLine.includes('background') || oracleText.includes('choose a background');
}

/**
 * Calculate the overall color identity of a deck by examining all cards
 */
function calculateDeckColorIdentity(cards: any[]): Set<string> {
  const deckColors = new Set<string>();
  for (const card of cards) {
    const colors = extractColorIdentity(card);
    for (const color of colors) {
      deckColors.add(color);
    }
  }
  return deckColors;
}

/**
 * Calculate how well commanders match the deck's color identity
 * Returns a score based on:
 * - How many deck colors are covered by commanders
 * - How many commander colors are NOT in the deck (penalty)
 * Higher score is better
 */
function calculateColorMatchScore(commanders: any[], deckColors: Set<string>): { score: number; coverage: number; extraColors: number } {
  const commanderColors = new Set<string>();
  for (const commander of commanders) {
    const colors = extractColorIdentity(commander);
    for (const color of colors) {
      commanderColors.add(color);
    }
  }
  
  // Count how many deck colors are covered
  let coverage = 0;
  for (const color of deckColors) {
    if (commanderColors.has(color)) {
      coverage++;
    }
  }
  
  // Count how many extra colors the commander has (not in deck)
  let extraColors = 0;
  for (const color of commanderColors) {
    if (!deckColors.has(color)) {
      extraColors++;
    }
  }
  
  // Score: prioritize coverage, penalize extra colors
  // Perfect match: coverage = deckColors.size, extraColors = 0
  const score = (coverage * 10) - (extraColors * 5);
  
  return { score, coverage, extraColors };
}

/**
 * Check if commanders' combined color identity exactly matches the deck's color identity
 * In Commander/EDH, the deck can only contain cards within the commander's color identity
 * Returns true if the identities match exactly, false otherwise
 */
function commanderIdentityMatchesDeck(commanders: any[], deckColors: Set<string>): boolean {
  const commanderColors = new Set<string>();
  for (const commander of commanders) {
    const colors = extractColorIdentity(commander);
    for (const color of colors) {
      commanderColors.add(color);
    }
  }
  
  // Check if sizes match first
  if (commanderColors.size !== deckColors.size) {
    return false;
  }
  
  // Check if all deck colors are in commander identity
  for (const color of deckColors) {
    if (!commanderColors.has(color)) {
      return false;
    }
  }
  
  // Check if all commander colors are in deck identity (no extra colors)
  for (const color of commanderColors) {
    if (!deckColors.has(color)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Find the best commander(s) from a deck's card list
 * Returns 1 or 2 commanders based on partner/background rules
 * 
 * Priority order:
 * 1. Check first 1-2 cards in decklist (commanders are typically listed first)
 *    - Validate that they exactly match the deck's color identity
 * 2. Look for partner pairs that exactly match deck colors
 * 3. Look for commander+background pairs that exactly match
 * 4. Fall back to first valid commander candidate (with mismatch warning)
 * 
 * Also calculates combined color identity of the selected commander(s)
 */
function findBestCommanders(cards: any[]): { commanders: any[]; colorIdentity: string[]; exactMatch: boolean } {
  // Find all valid commander candidates
  const candidates = cards.filter(isValidCommander);
  
  if (candidates.length === 0) {
    debugWarn(2, '[AI] No valid commander candidates found in deck');
    return { commanders: [], colorIdentity: [], exactMatch: false };
  }
  
  // Calculate the deck's overall color identity
  const deckColors = calculateDeckColorIdentity(cards);
  debug(1, '[AI] Deck color identity:', Array.from(deckColors).join(''));
  
  // Find partner candidates and background candidates
  const partnerCandidates = candidates.filter(hasPartner);
  const backgroundCandidates = cards.filter(c => (c.type_line || '').toLowerCase().includes('background'));
  const chooseBackgroundCandidates = candidates.filter(hasBackground);
  
  let selectedCommanders: any[] = [];
  
  // Priority 1: Check first 2 cards - commanders are often at the start of decklists
  const firstTwoCards = cards.slice(0, 2);
  const firstTwoCandidates = firstTwoCards.filter(isValidCommander);
  
  if (firstTwoCandidates.length > 0) {
    // Check if first two cards are both partners
    if (firstTwoCandidates.length === 2 && 
        hasPartner(firstTwoCandidates[0]) && hasPartner(firstTwoCandidates[1])) {
      // Validate that these partners' identity exactly matches the deck's color identity
      const identityMatches = commanderIdentityMatchesDeck(firstTwoCandidates, deckColors);
      if (identityMatches) {
        // Perfect match - use these commanders
        selectedCommanders = firstTwoCandidates;
        debug(1, '[AI] Selected partner commanders from first 2 cards (exact identity match):', selectedCommanders.map(c => c.name));
      } else {
        // Partners' identity doesn't match deck - look for better options
        const commanderColors = new Set<string>();
        firstTwoCandidates.forEach(c => extractColorIdentity(c).forEach(col => commanderColors.add(col)));
        debugWarn(1, '[AI] First 2 partner commanders identity', Array.from(commanderColors).join(''), 'does not match deck identity', Array.from(deckColors).join(''));
        // Fall through to Priority 2 to find better partners
      }
    }
    // Check if first two cards are commander + background pair
    else if (firstTwoCandidates.length >= 1 && selectedCommanders.length === 0) {
      const firstCard = firstTwoCandidates[0];
      const secondCard = firstTwoCards[1];
      
      if (hasBackground(firstCard) && secondCard && 
          (secondCard.type_line || '').toLowerCase().includes('background')) {
        // Check if this background pair matches deck identity
        const identityMatches = commanderIdentityMatchesDeck([firstCard, secondCard], deckColors);
        if (identityMatches) {
          selectedCommanders = [firstCard, secondCard];
          debug(1, '[AI] Selected commander + background from first 2 cards (exact identity match):', selectedCommanders.map(c => c.name));
        } else {
          debugWarn(2, '[AI] First 2 cards (commander + background) identity does not match deck identity');
        }
      } else if (secondCard && isValidCommander(secondCard) &&
                 (secondCard.type_line || '').toLowerCase().includes('background') && 
                 hasBackground(firstCard)) {
        // Check if this background pair matches deck identity
        const identityMatches = commanderIdentityMatchesDeck([firstCard, secondCard], deckColors);
        if (identityMatches) {
          selectedCommanders = [firstCard, secondCard];
          debug(1, '[AI] Selected commander + background from first 2 cards (exact identity match):', selectedCommanders.map(c => c.name));
        } else {
          debugWarn(2, '[AI] First 2 cards (background + commander) identity does not match deck identity');
        }
      } else {
        // Validate that the first card's identity exactly matches the deck's color identity
        // Safe to access firstCard since we checked length >= 1 above
        const identityMatches = commanderIdentityMatchesDeck([firstCard], deckColors);
        if (identityMatches) {
          // First card's identity matches deck - use it
          selectedCommanders = [firstCard];
          debug(1, `[AI] Selected single commander from first card (exact identity match): ${firstCard.name}`);
        } else {
          // First card's identity doesn't match deck
          // Continue searching for better options: partner pairs OR single commanders with exact match
          const firstCardColors = extractColorIdentity(firstCard);
          debugWarn(1, `[AI] First commander identity [${firstCardColors.join('')}] does not match deck identity [${Array.from(deckColors).join('')}] - searching for better options`);
          // Fall through to Priority 2 (partners), Priority 3 (backgrounds), or Priority 4 (single with exact match)
        }
      }
    }
  }
  
  // Priority 2: If no commanders found, find partner pair with exact identity match
  if (selectedCommanders.length === 0 && partnerCandidates.length >= 2) {
    // Find the partner pair whose identity exactly matches the deck
    let exactMatchPair: any[] = [];
    let bestPair: any[] = [];
    let bestCoverage = 0;
    
    for (let i = 0; i < partnerCandidates.length; i++) {
      for (let j = i + 1; j < partnerCandidates.length; j++) {
        const pair = [partnerCandidates[i], partnerCandidates[j]];
        
        // Check for exact identity match first
        if (commanderIdentityMatchesDeck(pair, deckColors)) {
          exactMatchPair = pair;
          break; // Found exact match, no need to continue
        }
        
        // Track best match score as fallback
        const matchInfo = calculateColorMatchScore(pair, deckColors);
        if (matchInfo.score > bestCoverage) {
          bestCoverage = matchInfo.score;
          bestPair = pair;
        }
      }
      if (exactMatchPair.length === 2) {
        break; // Found exact match, stop searching
      }
    }
    
    if (exactMatchPair.length === 2) {
      selectedCommanders = exactMatchPair;
      debug(1, `[AI] Selected partner commanders with exact identity match:`, selectedCommanders.map(c => c.name));
    } else if (bestPair.length === 2) {
      // Use best match even if not exact (in case of 1 wrong card in deck)
      selectedCommanders = bestPair;
      const matchInfo = calculateColorMatchScore(bestPair, deckColors);
      const pairColors = new Set<string>();
      bestPair.forEach(c => extractColorIdentity(c).forEach(col => pairColors.add(col)));
      debugWarn(1, `[AI] Selected partner commanders with closest match (score: ${matchInfo.score}, coverage: ${matchInfo.coverage}/${deckColors.size}, extra colors: ${matchInfo.extraColors}):`, selectedCommanders.map(c => c.name), `- Commander identity [${Array.from(pairColors).join('')}] vs Deck identity [${Array.from(deckColors).join('')}]`);
    } else {
      debugWarn(1, `[AI] No partner pair found for deck colors [${Array.from(deckColors).join('')}]`);
    }
  }
  
  // Priority 3: Check for background pair (exact match preferred, or closest match)
  if (selectedCommanders.length === 0 && 
      chooseBackgroundCandidates.length > 0 && backgroundCandidates.length > 0) {
    // Try each background combination to find best match
    let exactMatchPair: any[] = [];
    let bestPair: any[] = [];
    let bestScore = -Infinity;
    
    for (const cmdWithBackground of chooseBackgroundCandidates) {
      for (const background of backgroundCandidates) {
        const pair = [cmdWithBackground, background];
        
        if (commanderIdentityMatchesDeck(pair, deckColors)) {
          exactMatchPair = pair;
          break;
        }
        
        const matchInfo = calculateColorMatchScore(pair, deckColors);
        if (matchInfo.score > bestScore) {
          bestScore = matchInfo.score;
          bestPair = pair;
        }
      }
      if (exactMatchPair.length === 2) break;
    }
    
    if (exactMatchPair.length === 2) {
      selectedCommanders = exactMatchPair;
      debug(1, '[AI] Selected commander + background with exact identity match:', selectedCommanders.map(c => c.name));
    } else if (bestPair.length === 2) {
      selectedCommanders = bestPair;
      const matchInfo = calculateColorMatchScore(bestPair, deckColors);
      const pairColors = new Set<string>();
      bestPair.forEach(c => extractColorIdentity(c).forEach(col => pairColors.add(col)));
      debugWarn(1, `[AI] Selected commander + background with closest match (score: ${matchInfo.score}, coverage: ${matchInfo.coverage}/${deckColors.size}, extra colors: ${matchInfo.extraColors}):`, selectedCommanders.map(c => c.name), `- Identity [${Array.from(pairColors).join('')}] vs Deck [${Array.from(deckColors).join('')}]`);
    } else {
      debugWarn(1, `[AI] No background pair found for deck colors [${Array.from(deckColors).join('')}]`);
    }
  }
  
  // Priority 4: Find single commander (exact match preferred, or closest match)
  // This includes commanders with full color identity (e.g., 4-color commanders like Atraxa, Omnath)
  if (selectedCommanders.length === 0) {
    let exactMatchCommander: any = null;
    let bestCommander: any = null;
    let bestScore = -Infinity;
    
    for (const candidate of candidates) {
      // Check for exact identity match
      if (commanderIdentityMatchesDeck([candidate], deckColors)) {
        exactMatchCommander = candidate;
        break; // Found exact match, stop searching
      }
      
      // Track best match score
      const matchInfo = calculateColorMatchScore([candidate], deckColors);
      if (matchInfo.score > bestScore) {
        bestScore = matchInfo.score;
        bestCommander = candidate;
      }
    }
    
    if (exactMatchCommander) {
      selectedCommanders = [exactMatchCommander];
      const commanderColors = extractColorIdentity(exactMatchCommander);
      debug(1, `[AI] Selected single commander with exact identity match [${commanderColors.join('')}]: ${exactMatchCommander.name}`);
    } else if (bestCommander) {
      selectedCommanders = [bestCommander];
      const matchInfo = calculateColorMatchScore([bestCommander], deckColors);
      const commanderColors = extractColorIdentity(bestCommander);
      debugWarn(1, `[AI] Selected single commander with closest match (score: ${matchInfo.score}, coverage: ${matchInfo.coverage}/${deckColors.size}, extra colors: ${matchInfo.extraColors}) [${commanderColors.join('')}]: ${bestCommander.name} - Deck identity [${Array.from(deckColors).join('')}]`);
    } else {
      // Ultimate fallback - shouldn't happen if there are any candidates
      if (candidates.length > 0) {
        selectedCommanders = [candidates[0]];
        const fallbackColors = extractColorIdentity(candidates[0]);
        debugError(1, `[AI] Using fallback commander (no valid candidates) [${fallbackColors.join('')}]: ${candidates[0]?.name} - Deck identity [${Array.from(deckColors).join('')}]`);
      }
    }
  }
  
  // Check if we found an exact match
  const exactMatch = selectedCommanders.length > 0 && commanderIdentityMatchesDeck(selectedCommanders, deckColors);
  
  // Calculate combined color identity
  const colorIdentity = new Set<string>();
  for (const commander of selectedCommanders) {
    for (const color of extractColorIdentity(commander)) {
      colorIdentity.add(color);
    }
  }
  
  return {
    commanders: selectedCommanders,
    colorIdentity: Array.from(colorIdentity),
    exactMatch,
  };
}

/** Generate a unique ID using crypto */
function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

/**
 * Auto-select and set commander for an AI player based on their deck
 * This is called after deck loading to ensure the AI can start the game
 */
export async function autoSelectAICommander(
  io: Server,
  gameId: string,
  playerId: PlayerID
): Promise<boolean> {
  try {
    const game = ensureGame(gameId);
    if (!game || !game.state) {
      debugWarn(2, '[AI] autoSelectAICommander: game not found', { gameId, playerId });
      return false;
    }
    
    // Check if player already has a commander - if so, don't select again
    const commanderInfo = game.state.commandZone?.[playerId];
    const hasCommander = commanderInfo?.commanderIds?.length > 0;
    if (hasCommander) {
      debug(1, '[AI] autoSelectAICommander: player already has commander, skipping', { 
        gameId, 
        playerId,
        commanderIds: commanderInfo?.commanderIds 
      });
      return true; // Return true since commander is already set
    }
    
    // Get the AI player's library (deck)
    // The library is stored in ctx.libraries Map via importDeckResolved.
    // Use searchLibrary with empty query to get all cards (up to limit).
    let library: any[] = [];
    if (typeof (game as any).searchLibrary === 'function') {
      // searchLibrary returns cards from ctx.libraries Map
      library = (game as any).searchLibrary(playerId, '', MAX_LIBRARY_SEARCH_LIMIT) || [];
    } else {
      // Fallback to zones.library if searchLibrary not available (e.g., MinimalGameAdapter)
      const zones = game.state.zones?.[playerId] as any;
      library = zones?.library || [];
    }
    
    if (library.length === 0) {
      debugWarn(2, '[AI] autoSelectAICommander: no cards in library', { gameId, playerId });
      return false;
    }
    
    // Validate that library cards have required data (name, type_line, etc.)
    const cardsForSelection = library.filter((c: any) => c && c.name && c.type_line);
    if (cardsForSelection.length === 0) {
      debugError(1, '[AI] autoSelectAICommander: library has cards but they lack required data', {
        gameId,
        playerId,
        totalCards: library.length,
        sampleCard: library[0],
      });
      return false;
    }
    
    if (cardsForSelection.length < library.length) {
      debugWarn(1, '[AI] autoSelectAICommander: filtered out cards lacking required data', {
        gameId,
        playerId,
        totalCards: library.length,
        validCards: cardsForSelection.length,
      });
    }
    
    debug(1, '[AI] autoSelectAICommander: found library with', cardsForSelection.length, 'cards');
    
    // Log the first few cards to help debug commander selection
    if (cardsForSelection.length > 0) {
      const firstCards = cardsForSelection.slice(0, 3).map((c: any) => ({
        name: c.name,
        type: c.type_line,
        colors: c.color_identity || [],
      }));
      debug(1, '[AI] First cards in library:', JSON.stringify(firstCards));
    }
    
    // Find the best commander(s) from the deck (uses original unshuffled order)
    let { commanders, colorIdentity, exactMatch } = findBestCommanders(cardsForSelection);
    
    if (commanders.length === 0) {
      debugWarn(2, '[AI] autoSelectAICommander: no valid commander found', { gameId, playerId });
      
      // Send alert to all players
      io.to(gameId).emit('error', {
        code: 'NO_COMMANDER_FOUND',
        message: 'AI deck has no valid commander candidates'
      });
      
      // Send chat message
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `⚠️ AI player has no valid commander in deck. Cannot start game.`,
        ts: Date.now(),
      });
      
      return false;
    }
    
    // Check if commander identity matches deck
    if (!exactMatch) {
      // Send warning to all players about identity mismatch
      const deckColors = calculateDeckColorIdentity(cardsForSelection);
      const commanderColors = new Set<string>();
      commanders.forEach((cmd: any) => extractColorIdentity(cmd).forEach(c => commanderColors.add(c)));
      
      const commanderNames = commanders.map((c: any) => c.name).join(' + ');
      const deckIdentityStr = Array.from(deckColors).join('');
      const commanderIdentityStr = Array.from(commanderColors).join('');
      
      debugWarn(1, '[AI] Commander identity mismatch:', {
        gameId,
        playerId,
        commanders: commanderNames,
        commanderIdentity: commanderIdentityStr,
        deckIdentity: deckIdentityStr,
      });
      
      // Send warning notification
      io.to(gameId).emit('warning', {
        code: 'COMMANDER_IDENTITY_MISMATCH',
        message: `AI commander identity [${commanderIdentityStr}] does not exactly match deck identity [${deckIdentityStr}]`,
        details: {
          commanders: commanderNames,
          commanderIdentity: commanderIdentityStr,
          deckIdentity: deckIdentityStr,
        }
      });
      
      // Send chat message
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `⚠️ AI commander ${commanderNames} [${commanderIdentityStr}] does not match deck identity [${deckIdentityStr}]. This may indicate deck construction errors.`,
        ts: Date.now(),
      });
    }
    
    // Set commander using the game's setCommander function
    const commanderNames = commanders.map((c: any) => c.name);
    const commanderIds = commanders.map((c: any) => c.id);
    
    debug(1, '[AI] Auto-selecting commander for AI:', {
      gameId,
      playerId,
      commanderNames,
      commanderIds,
      colorIdentity,
    });
    
    // Flag for pending opening draw (shuffle + draw 7)
    if (typeof (game as any).flagPendingOpeningDraw === 'function') {
      (game as any).flagPendingOpeningDraw(playerId);
    } else if ((game as any).pendingInitialDraw) {
      (game as any).pendingInitialDraw.add(playerId);
    }
    
    // Check if we'll do the opening draw (hand empty and pending flag set)
    // This mirrors the logic in commander.ts socket handler
    const pendingSet = (game as any).pendingInitialDraw as Set<string> | undefined;
    const willDoOpeningDraw = pendingSet && pendingSet.has(playerId);
    const zonesBefore = game.state?.zones?.[playerId];
    const handCountBefore = zonesBefore
      ? (typeof zonesBefore.handCount === "number" ? zonesBefore.handCount : (Array.isArray(zonesBefore.hand) ? zonesBefore.hand.length : 0))
      : 0;
    const doingOpeningDraw = willDoOpeningDraw && handCountBefore === 0;
    
    // Call setCommander to set up the commander and trigger opening draw
    if (typeof (game as any).setCommander === 'function') {
      (game as any).setCommander(playerId, commanderNames, commanderIds, colorIdentity);
      
      // Verify the opening draw happened
      const zonesAfter = game.state.zones?.[playerId];
      const handCount = zonesAfter?.handCount ?? (Array.isArray(zonesAfter?.hand) ? zonesAfter.hand.length : 0);
      
      debug(1, '[AI] After setCommander - hand count:', handCount);
      
      // If hand is empty, manually trigger shuffle and draw
      // (This is a fallback if the pendingInitialDraw didn't work)
      let didManualDraw = false;
      if (handCount === 0) {
        debug(1, '[AI] Hand is empty after setCommander, manually triggering shuffle and draw');
        didManualDraw = true;
        
        // Shuffle the library
        if (typeof (game as any).shuffleLibrary === 'function') {
          (game as any).shuffleLibrary(playerId);
          debug(1, '[AI] Library shuffled');
        }
        
        // Draw initial hand
        if (typeof (game as any).drawCards === 'function') {
          const drawn = (game as any).drawCards(playerId, INITIAL_HAND_SIZE);
          debug(1, '[AI] Drew', drawn?.length || 0, 'cards');
        }
      }
      
      // Persist the events - this is critical for undo/replay to work correctly
      try {
        await appendEvent(gameId, (game as any).seq || 0, 'setCommander', {
          playerId,
          commanderNames,
          commanderIds,
          colorIdentity,
          isAI: true,
        });
        
        // Persist shuffle and draw events if opening draw happened
        // This ensures undo/replay produces the same hand contents
        if (doingOpeningDraw || didManualDraw) {
          await appendEvent(gameId, (game as any).seq || 0, 'shuffleLibrary', { playerId });
          await appendEvent(gameId, (game as any).seq || 0, 'drawCards', { playerId, count: INITIAL_HAND_SIZE });
          debug(1, '[AI] Persisted opening draw events (shuffle + draw) for player', playerId);
        }
      } catch (e) {
        debugWarn(1, '[AI] Failed to persist setCommander event:', e);
      }
      
      // Broadcast updated state to all players
      broadcastGame(io, game, gameId);
      
      debug(1, '[AI] Commander set for AI player:', {
        gameId,
        playerId,
        commanderNames,
        finalHandCount: game.state.zones?.[playerId]?.handCount,
      });
      
      return true;
    } else {
      debugError(1, '[AI] game.setCommander not available');
      return false;
    }
    
  } catch (error) {
    debugError(1, '[AI] Error auto-selecting commander:', error);
    return false;
  }
}

/**
 * Handle AI game flow - called when game state changes
 * Ensures AI progresses through pre-game, commander selection, and turn phases
 */
export async function handleAIGameFlow(
  io: Server,
  gameId: string,
  playerId: PlayerID
): Promise<void> {
  if (!isAIPlayer(gameId, playerId)) {
    return;
  }
  
  const game = ensureGame(gameId);
  if (!game || !game.state) {
    return;
  }
  
  // Check if this AI player has lost the game
  const players = game.state.players || [];
  const aiPlayer = players.find((p: any) => p.id === playerId);
  if (aiPlayer?.hasLost) {
    debug(1, '[AI] handleAIGameFlow: AI player has lost the game, skipping:', { gameId, playerId });
    return;
  }
  
  // Check if this AI player is in the inactive set
  const ctx = (game as any).ctx || game;
  const inactiveSet = ctx.inactive instanceof Set ? ctx.inactive : new Set();
  if (inactiveSet.has(playerId)) {
    debug(1, '[AI] handleAIGameFlow: AI player is inactive, skipping:', { gameId, playerId });
    return;
  }
  
  const phaseStr = String(game.state.phase || '').toUpperCase();
  const stepStr = String((game.state as any).step || '').toUpperCase();
  const commanderInfo = game.state.commandZone?.[playerId];
  const hasCommander = commanderInfo?.commanderIds?.length > 0;
  const zones = game.state.zones?.[playerId];
  const hasHand = (zones?.handCount || 0) > 0 || (zones?.hand?.length || 0) > 0;
  const isAITurn = game.state.turnPlayer === playerId;
  const hasPriority = game.state.priority === playerId;
  
  // Leyline resolution delay - time to allow human players to play/skip Leylines before advancing
  const LEYLINE_RESOLUTION_DELAY_MS = AI_THINK_TIME_MS * 2;
  
  debug(1, '[AI] handleAIGameFlow:', {
    gameId,
    playerId,
    phase: phaseStr,
    step: stepStr,
    hasCommander,
    hasHand,
    handCount: zones?.handCount,
    isAITurn,
    hasPriority,
  });
  
  // Pre-game phase: select commander if not done
  if (phaseStr === '' || phaseStr === 'PRE_GAME') {
    if (!hasCommander) {
      debug(1, '[AI] AI needs to select commander');
      
      // Small delay to allow deck to be fully set up
      setTimeout(async () => {
        const success = await autoSelectAICommander(io, gameId, playerId);
        if (success) {
          debug(1, '[AI] Commander selection complete, continuing game flow');
          // Re-trigger game flow after commander selection
          setTimeout(() => handleAIGameFlow(io, gameId, playerId), AI_THINK_TIME_MS);
        }
      }, AI_REACTION_DELAY_MS);
      return;
    }
    
    // If we have a commander and hand, auto-keep the hand
    // This is critical to prevent the game from stalling when waiting for AI to keep hand
    if (hasCommander && hasHand) {
      // Check if AI has already kept their hand
      const mulliganState = (game.state as any).mulliganState || {};
      const aiMulliganState = mulliganState[playerId];
      
      if (!aiMulliganState || !aiMulliganState.hasKeptHand) {
        // AI needs to decide whether to keep or mulligan
        debug(1, '[AI] AI evaluating hand for mulligan decision');
        
        const keepHand = await handleAIMulligan(io, gameId, playerId);
        
        if (keepHand) {
          // Keep the hand
          debug(1, '[AI] AI keeping hand');
          
          (game.state as any).mulliganState = (game.state as any).mulliganState || {};
          (game.state as any).mulliganState[playerId] = {
            hasKeptHand: true,
            mulligansTaken: aiMulliganState?.mulligansTaken || 0,
          };
          
          // Bump sequence to propagate state change
          if (typeof (game as any).bumpSeq === 'function') {
            (game as any).bumpSeq();
          }
          
          debug(1, '[AI] AI is ready to start game (hand kept)');
          
          // Broadcast updated state so human players see AI has kept hand
          broadcastGame(io, game, gameId);
          
          // After keeping hand, re-trigger game flow to check for advancement
          setTimeout(() => handleAIGameFlow(io, gameId, playerId), AI_THINK_TIME_MS);
          return;
        } else {
          // Take a mulligan
          debug(1, '[AI] AI taking mulligan');
          
          const currentMulligans = aiMulliganState?.mulligansTaken || 0;
          const newMulliganCount = currentMulligans + 1;
          
          // Check if player can still mulligan (max 7 mulligans = 0 cards)
          if (newMulliganCount > 7) {
            debugWarn(1, '[AI] AI cannot mulligan further - would have 0 cards');
            // Force keep the hand
            (game.state as any).mulliganState = (game.state as any).mulliganState || {};
            (game.state as any).mulliganState[playerId] = {
              hasKeptHand: true,
              mulligansTaken: currentMulligans,
            };
            broadcastGame(io, game, gameId);
            setTimeout(() => handleAIGameFlow(io, gameId, playerId), AI_THINK_TIME_MS);
            return;
          }
          
          // Update mulligan count but DON'T set hasKeptHand yet
          (game.state as any).mulliganState = (game.state as any).mulliganState || {};
          (game.state as any).mulliganState[playerId] = {
            hasKeptHand: false,
            mulligansTaken: newMulliganCount,
          };
          
          // Execute the mulligan by moving hand to library, shuffling, and drawing new hand
          // This matches the logic in game-actions.ts socket handler
          try {
            debug(1, `[AI] Executing mulligan #${newMulliganCount} for AI player`);
            
            // Move hand back to library
            if (typeof (game as any).moveHandToLibrary === 'function') {
              (game as any).moveHandToLibrary(playerId);
              debug(1, '[AI] Moved hand to library');
            } else {
              debugWarn(2, '[AI] game.moveHandToLibrary not available');
            }
            
            // Shuffle library
            if (typeof (game as any).shuffleLibrary === 'function') {
              (game as any).shuffleLibrary(playerId);
              debug(1, '[AI] Shuffled library');
            } else {
              debugWarn(2, '[AI] game.shuffleLibrary not available');
            }
            
            // Draw new 7-card hand (London mulligan - put cards back later when keeping)
            if (typeof (game as any).drawCards === 'function') {
              const drawn = (game as any).drawCards(playerId, 7);
              debug(1, '[AI] Drew new 7-card hand, actual drawn:', drawn?.length || 0);
            } else {
              debugWarn(2, '[AI] game.drawCards not available');
            }
            
            // Bump sequence
            if (typeof (game as any).bumpSeq === 'function') {
              (game as any).bumpSeq();
            }
            
            debug(1, '[AI] Mulligan executed successfully');
          } catch (e) {
            debugError(1, '[AI] Error executing mulligan:', e);
          }
          
          // Persist the mulligan event
          try {
            await appendEvent(gameId, (game as any).seq || 0, 'mulligan', {
              playerId,
              mulliganNumber: newMulliganCount,
              isAI: true,
            });
          } catch (e) {
            debugWarn(1, '[AI] Failed to persist mulligan event:', e);
          }
          
          // Broadcast updated state
          broadcastGame(io, game, gameId);
          
          // Re-trigger game flow to evaluate the new hand
          setTimeout(() => handleAIGameFlow(io, gameId, playerId), AI_THINK_TIME_MS);
          return;
        }
      }
      
      // AI has already kept hand - now check if we should advance from pre_game
      // This happens when:
      // 1. AI is the active player (turnPlayer)
      // 2. All players have kept their hands
      // 3. All pending Leyline/opening hand actions are resolved
      if (isAITurn) {
        debug(1, '[AI] AI is active player in pre_game, checking if ready to advance');
        
        // Get mulligan state for checking hand keeping status
        const mulliganState = (game.state as any).mulliganState || {};
        
        // Check if all players have kept their hands
        const allPlayers = players.filter((p: any) => p && !p.spectator);
        const allKeptHands = allPlayers.every((p: any) => {
          const pMulliganState = mulliganState[p.id];
          return pMulliganState && pMulliganState.hasKeptHand;
        });
        
        if (!allKeptHands) {
          debug(1, '[AI] Waiting for other players to keep their hands');
          return;
        }
        
        // Check for pending Leyline/opening hand actions
        // Players with Leylines in hand will have a pending prompt
        // We need to wait for them to either play or skip Leylines
        
        // Use the same Leyline detection logic from opening-hand.ts
        const isLeylineCard = (card: any): boolean => {
          if (!card) return false;
          const oracleText = (card.oracle_text || '').toLowerCase();
          const cardName = (card.name || '').toLowerCase();
          return (
            (oracleText.includes('in your opening hand') &&
             oracleText.includes('begin the game with')) ||
            cardName.startsWith('leyline of') ||
            cardName === 'gemstone caverns'
          );
        };
        
        let hasPendingLeylineActions = false;
        for (const player of allPlayers) {
          const pid = player.id;
          // Check if player has Leyline cards in hand
          const pZones = game.state.zones?.[pid];
          if (pZones && Array.isArray(pZones.hand)) {
            const hasLeylines = pZones.hand.some(isLeylineCard);
            
            if (hasLeylines && !isAIPlayer(gameId, pid)) {
              // Human player has Leylines - they might still need to resolve them
              // Check if they've already been prompted (we track this implicitly by checking
              // if the game has broadcast since they kept their hand)
              // For safety, give them a brief window to act
              hasPendingLeylineActions = true;
              debug(1, `[AI] Player ${pid} has Leyline cards, waiting for resolution`);
            }
          }
        }
        
        // If there are pending Leyline actions, wait a bit longer for players to resolve them
        // This is a conservative check - in practice, the Leyline prompt should be shown
        // immediately after keeping hand, but we give a small grace period
        if (hasPendingLeylineActions) {
          // Re-check after a delay to allow human players to play/skip Leylines
          setTimeout(() => handleAIGameFlow(io, gameId, playerId), LEYLINE_RESOLUTION_DELAY_MS);
          return;
        }
        
        // All conditions met - advance from pre_game to beginning phase
        debug(1, '[AI] All players ready, AI advancing from pre_game to beginning phase');
        
        try {
          // Use nextTurn to advance from pre_game to the first turn
          // nextTurn properly sets phase="beginning", step="UNTAP", untaps permanents, 
          // then advances to step="UPKEEP" and sets priority to the active player.
          // Note: nextStep() explicitly blocks during pre_game phase, so we must use nextTurn()
          if (typeof (game as any).nextTurn === 'function') {
            (game as any).nextTurn();
            debug(1, '[AI] Advanced game from pre_game to beginning phase via nextTurn');
            
            // Persist the event
            const gameSeq = (game as any).seq;
            if (typeof gameSeq !== 'number') {
              debugError(1, '[AI] game.seq is not a number, cannot persist event');
            } else {
              try {
                await appendEvent(gameId, gameSeq, 'nextTurn', {
                  playerId,
                  reason: 'ai_pregame_advance',
                  isAI: true,
                });
              } catch (e) {
                debugWarn(1, '[AI] Failed to persist nextTurn event:', e);
              }
            }
            
            // Broadcast updated state
            broadcastGame(io, game, gameId);
            
            // Re-trigger AI game flow to handle the new phase
            setTimeout(() => handleAIGameFlow(io, gameId, playerId), AI_THINK_TIME_MS);
          } else {
            debugError(1, '[AI] game.nextTurn not available');
          }
        } catch (err) {
          debugError(1, '[AI] Error advancing from pre_game:', err);
        }
        
        return;
      } else {
        debug(1, '[AI] AI has kept hand but is not active player, waiting');
      }
    }
    return;
  }
  
  // Active game phases: handle priority if AI has it
  // SPECIAL CASE: During cleanup step, call handleAIPriority even without priority
  // Per MTG Rule 514.1, cleanup step does not grant priority, but the turn player
  // must still perform mandatory actions (discard to hand size, etc.)
  const isCleanupStep = stepStr.toUpperCase() === 'CLEANUP';
  
  if (hasPriority || (isCleanupStep && isAITurn)) {
    // Small delay before AI takes action
    setTimeout(async () => {
      await handleAIPriority(io, gameId, playerId);
    }, AI_REACTION_DELAY_MS);
  }
}

// Singleton AI Engine instance
const aiEngine = new AIEngine();

// Track AI players per game
const aiPlayers = new Map<string, Map<PlayerID, AIPlayerConfig>>();

/**
 * Register an AI player for a game
 */
export function registerAIPlayer(
  gameId: string,
  playerId: PlayerID,
  name: string,
  strategy: AIStrategy = AIStrategy.BASIC,
  difficulty: number = 0.5
): void {
  const config: AIPlayerConfig = {
    playerId,
    strategy,
    difficulty,
    thinkTime: 500, // 500ms delay for more natural feel
  };
  
  aiEngine.registerAI(config);
  
  // Track in per-game map
  if (!aiPlayers.has(gameId)) {
    aiPlayers.set(gameId, new Map());
  }
  aiPlayers.get(gameId)!.set(playerId, config);
  
  // Add AI player to auto-pass set so they automatically pass when they can't respond
  const game = ensureGame(gameId);
  if (game && game.state) {
    const stateAny = game.state as any;
    if (!stateAny.autoPassPlayers || !(stateAny.autoPassPlayers instanceof Set)) {
      stateAny.autoPassPlayers = new Set();
    }
    stateAny.autoPassPlayers.add(playerId);
    debug(1, '[AI] Added AI player to auto-pass set:', { gameId, playerId });
  }
  
  debug(1, '[AI] Registered AI player:', { gameId, playerId, name, strategy, difficulty });
}

/**
 * Unregister an AI player
 */
export function unregisterAIPlayer(gameId: string, playerId: PlayerID): void {
  aiEngine.unregisterAI(playerId);
  
  const gameAIs = aiPlayers.get(gameId);
  if (gameAIs) {
    gameAIs.delete(playerId);
    if (gameAIs.size === 0) {
      aiPlayers.delete(gameId);
    }
  }
  
  // Remove AI player from auto-pass set
  const game = ensureGame(gameId);
  if (game && game.state) {
    const stateAny = game.state as any;
    if (stateAny.autoPassPlayers && stateAny.autoPassPlayers instanceof Set) {
      stateAny.autoPassPlayers.delete(playerId);
      debug(1, '[AI] Removed AI player from auto-pass set:', { gameId, playerId });
    }
  }
  
  debug(1, '[AI] Unregistered AI player:', { gameId, playerId });
}

/**
 * Check if a player is AI-controlled
 */
export function isAIPlayer(gameId: string, playerId: PlayerID): boolean {
  return aiPlayers.get(gameId)?.has(playerId) ?? false;
}

/**
 * Get all AI players for a game
 */
export function getAIPlayers(gameId: string): PlayerID[] {
  const gameAIs = aiPlayers.get(gameId);
  return gameAIs ? Array.from(gameAIs.keys()) : [];
}

/**
 * Check if a card is a land
 */
function isLandCard(card: any): boolean {
  const typeLine = (card?.type_line || '').toLowerCase();
  return typeLine.includes('land');
}

/**
 * Check if AI can play a land (hasn't played one this turn and is in main phase)
 */
function canAIPlayLand(game: any, playerId: PlayerID): boolean {
  const phase = String(game.state?.phase || '').toLowerCase();
  const step = String(game.state?.step || '').toLowerCase();
  const isMainPhase = phase.includes('main') || step.includes('main');
  const isAITurn = game.state?.turnPlayer === playerId;
  const landsPlayed = game.state?.landsPlayedThisTurn?.[playerId] || 0;
  // Default max is 1, but effects like Exploration, Azusa, Rites of Flourishing can increase it
  const maxLands = (game.maxLandsPerTurn?.[playerId] ?? game.state?.maxLandsPerTurn?.[playerId]) || 1;
  
  return isMainPhase && isAITurn && landsPlayed < maxLands;
}

/**
 * Find a playable land in the AI's hand
 */
function findPlayableLand(game: any, playerId: PlayerID): any | null {
  const zones = game.state?.zones?.[playerId];
  const hand = Array.isArray(zones?.hand) ? zones.hand : [];
  
  for (const card of hand) {
    if (isLandCard(card)) {
      return card;
    }
  }
  return null;
}

/**
 * Determine what color of mana a permanent can produce based on its type and oracle text
 * Works for lands, mana rocks (artifacts), and creatures with mana abilities
 */
function getManaProduction(card: any): string[] {
  const typeLine = (card?.type_line || '').toLowerCase();
  const oracleText = (card?.oracle_text || '').toLowerCase();
  const colors: string[] = [];
  
  // Basic land types produce their respective colors
  if (typeLine.includes('plains')) colors.push('W');
  if (typeLine.includes('island')) colors.push('U');
  if (typeLine.includes('swamp')) colors.push('B');
  if (typeLine.includes('mountain')) colors.push('R');
  if (typeLine.includes('forest')) colors.push('G');
  
  // Check oracle text for mana abilities (tap: add mana patterns)
  // Common patterns: "{T}: Add {W}", "Add {G}", "{T}: Add one mana of any color"
  if (oracleText.includes('{w}') || oracleText.includes('add {w}')) colors.push('W');
  if (oracleText.includes('{u}') || oracleText.includes('add {u}')) colors.push('U');
  if (oracleText.includes('{b}') || oracleText.includes('add {b}')) colors.push('B');
  if (oracleText.includes('{r}') || oracleText.includes('add {r}')) colors.push('R');
  if (oracleText.includes('{g}') || oracleText.includes('add {g}')) colors.push('G');
  if (oracleText.includes('{c}') || oracleText.includes('add {c}')) colors.push('C');
  
  // Permanents that add any color (e.g., Command Tower, City of Brass, Mana Confluence, Chromatic Lantern affected permanents)
  if (oracleText.includes('add one mana of any color') || 
      oracleText.includes('any color of mana') ||
      oracleText.includes('mana of any one color') ||
      oracleText.includes('add one mana of any type')) {
    return ['W', 'U', 'B', 'R', 'G']; // Can produce any color
  }
  
  // Sol Ring and similar - "Add {C}{C}" means it produces 2 colorless
  // For simplicity, we just track that it can produce colorless
  if (oracleText.includes('{c}{c}') || oracleText.includes('add {c}{c}')) {
    colors.push('C');
  }
  
  // If no specific colors found but it's a land, assume colorless
  if (colors.length === 0 && typeLine.includes('land')) {
    colors.push('C');
  }
  
  // Remove duplicates
  return [...new Set(colors)];
}

/**
 * Check if a permanent has a mana ability (can tap for mana)
 * IMPORTANT: Cards that "create" treasure tokens should NOT be treated as having mana abilities
 * Only actual Treasure tokens (with the sacrifice ability) have mana abilities
 */
function hasManaAbility(card: any): boolean {
  const oracleText = (card?.oracle_text || '').toLowerCase();
  const typeLine = (card?.type_line || '').toLowerCase();
  const cardName = (card?.name || '').toLowerCase();
  
  // Lands always have implicit mana abilities (basic lands)
  if (typeLine.includes('land')) return true;
  
  // IMPORTANT: Cards that "create" treasure/food/clue tokens do NOT have mana abilities
  // Only actual Treasure tokens have mana abilities
  // Detect cards that create treasures vs actual treasures
  if (oracleText.includes('create') && 
      (oracleText.includes('treasure') || oracleText.includes('food') || oracleText.includes('clue'))) {
    // This card creates tokens, it's not itself a token with mana ability
    // Check if it's actually a Treasure subtype by looking at type_line
    const hasEmDash = typeLine.includes("—") || typeLine.includes("-");
    if (hasEmDash) {
      const subtypePortion = typeLine.split(/[—-]/)[1] || "";
      // If not an actual Treasure/Food/Clue subtype, don't give it mana abilities
      if (!subtypePortion.includes("treasure") && 
          !subtypePortion.includes("food") && 
          !subtypePortion.includes("clue")) {
        return false;
      }
    } else {
      // No subtype section, so this is a card that creates tokens, not a token itself
      return false;
    }
  }
  
  // Check for tap-to-add-mana pattern: "{T}: Add" or "{T}, ... : Add"
  if (oracleText.includes('{t}') && oracleText.includes('add {')) return true;
  if (oracleText.includes('{t}') && oracleText.includes('add one mana')) return true;
  if (oracleText.includes('{t}') && oracleText.includes('add mana')) return true;
  
  // Treasure tokens: "{T}, Sacrifice this artifact: Add one mana of any color."
  // Check for this specific pattern (sacrifice to add mana)
  if (oracleText.includes('sacrifice') && oracleText.includes('add one mana of any color')) {
    // Verify it's actually a Treasure artifact by checking type_line
    if (typeLine.includes('treasure') || typeLine.includes('artifact')) {
      return true;
    }
  }
  
  // Known mana rocks and dorks
  const knownManaSources = [
    'sol ring', 'mana crypt', 'mana vault', 'arcane signet', 'mind stone',
    'fellwar stone', 'thought vessel', 'commander\'s sphere', 'chromatic lantern',
    'llanowar elves', 'elvish mystic', 'birds of paradise', 'noble hierarch',
    'deathrite shaman', 'avacyn\'s pilgrim', 'elves of deep shadow',
    'bloom tender', 'priest of titania', 'elvish archdruid'
  ];
  if (knownManaSources.some(name => cardName.includes(name))) return true;
  
  return false;
}

/**
 * Check if a creature has summoning sickness (can't tap for mana)
 */
function hasCreatureSummoningSickness(perm: any): boolean {
  const typeLine = (perm.card?.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) return false;
  
  // Check for summoning sickness flag or if it just entered
  return perm.summoningSickness === true;
}

/**
 * Calculate available mana from untapped mana sources on the battlefield
 * Includes lands, mana rocks (artifacts), and creatures with mana abilities
 * Returns total mana available and a map of which sources can produce each color
 */
/**
 * Calculate available mana for AI using the same system as humans
 * This ensures consistency between AI and human mana calculations
 */
function calculateAvailableMana(game: any, playerId: PlayerID): { total: number; colors: Record<string, number>; sourcesByColor: Map<string, string[]> } {
  // Use the shared getAvailableMana function from mana-check.ts
  const manaPool = getAvailableMana(game.state, playerId);
  
  // Convert the pool format to what AI expects
  const colors: Record<string, number> = {
    W: manaPool.white || 0,
    U: manaPool.blue || 0,
    B: manaPool.black || 0,
    R: manaPool.red || 0,
    G: manaPool.green || 0,
    C: manaPool.colorless || 0,
  };
  
  const total = getTotalManaFromPool(manaPool);
  
  // Build sourcesByColor map for payment source tracking
  // This requires iterating through battlefield to find which permanents produce which colors
  const sourcesByColor = new Map<string, string[]>();
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) {
    sourcesByColor.set(color, []);
  }
  
  const battlefield = game.state?.battlefield || [];
  for (const perm of battlefield) {
    if (perm && perm.controller === playerId && !perm.tapped) {
      // Check if this permanent can produce mana
      if (!hasManaAbility(perm.card)) continue;
      
      // Creatures with summoning sickness can't tap for mana
      if (hasCreatureSummoningSickness(perm)) continue;
      
      const producedColors = getManaProduction(perm.card);
      if (producedColors.length === 0) continue;
      
      // Track which sources can produce each color
      for (const color of producedColors) {
        const sources = sourcesByColor.get(color) || [];
        sources.push(perm.id);
        sourcesByColor.set(color, sources);
      }
    }
  }
  
  return { total, colors, sourcesByColor };
}

/**
 * Parse mana cost and return total CMC and color requirements
 * Handles hybrid mana by treating it as requiring any of its colors
 */
function parseSpellCost(manaCost: string): { cmc: number; colors: Record<string, number>; generic: number; hybrids: string[][] } {
  const colors: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const hybrids: string[][] = [];
  let generic = 0;
  
  if (!manaCost) return { cmc: 0, colors, generic: 0, hybrids: [] };
  
  const tokens = manaCost.match(/\{[^}]+\}/g) || [];
  for (const token of tokens) {
    const clean = token.replace(/[{}]/g, '').toUpperCase();
    if (/^\d+$/.test(clean)) {
      generic += parseInt(clean, 10);
    } else if (clean.includes('/')) {
      // Hybrid mana like {R/W} or {2/W}
      const parts = clean.split('/');
      hybrids.push(parts);
    } else if (clean.length === 1 && Object.prototype.hasOwnProperty.call(colors, clean)) {
      colors[clean] = (colors[clean] || 0) + 1;
    }
  }
  
  // CMC includes hybrid mana (each hybrid counts as 1)
  const coloredTotal = Object.values(colors).reduce((a, b) => a + b, 0);
  return { cmc: generic + coloredTotal + hybrids.length, colors, generic, hybrids };
}

/**
 * Check if AI can afford to cast a spell given available mana
 */
function canAffordSpell(available: { total: number; colors: Record<string, number> }, cost: { cmc: number; colors: Record<string, number>; generic: number; hybrids?: string[][] }): boolean {
  // Check if we have enough total mana
  if (available.total < cost.cmc) return false;
  
  // Check if we can pay colored requirements
  for (const [color, needed] of Object.entries(cost.colors)) {
    if (needed > 0) {
      // Count lands that can produce this color
      const availableOfColor = available.colors[color] || 0;
      if (availableOfColor < needed) return false;
    }
  }
  
  // Check hybrid mana requirements (need at least one of the options)
  if (cost.hybrids && cost.hybrids.length > 0) {
    for (const hybrid of cost.hybrids) {
      // For hybrid, check if we can pay with any of the options
      const canPayHybrid = hybrid.some(option => {
        if (/^\d+$/.test(option)) {
          // Numeric option like {2/W} - can pay with 2 generic
          return available.total >= parseInt(option, 10);
        }
        // Color option - need a land that produces this color
        return (available.colors[option] || 0) > 0;
      });
      if (!canPayHybrid) return false;
    }
  }
  
  return true;
}

/**
 * Find castable spells in AI's hand, sorted by priority
 */
/**
 * Find all spells in hand that AI can currently afford to cast
 * Uses shared mana calculation system for consistency with human players
 */
function findCastableSpells(game: any, playerId: PlayerID): any[] {
  const zones = game.state?.zones?.[playerId];
  const hand = Array.isArray(zones?.hand) ? zones.hand : [];
  
  // Debug: Log the hand contents to help diagnose issues
  if (hand.length === 0) {
    debug(1, '[AI] findCastableSpells: Hand is empty');
    return [];
  }
  
  debug(1, `[AI] findCastableSpells: Checking ${hand.length} cards in hand`);
  
  // Use shared mana calculation
  const manaPool = getAvailableMana(game.state, playerId);
  const totalMana = getTotalManaFromPool(manaPool);
  
  debug(1, '[AI] Available mana pool:', { 
    total: totalMana, 
    colors: manaPool 
  });
  
  const castable: any[] = [];
  const uncostable: { name: string; manaCost: string; reason: string }[] = [];
  
  for (const card of hand) {
    const typeLine = (card?.type_line || '').toLowerCase();
    const cardName = card?.name || 'Unknown';
    const oracleText = (card?.oracle_text || '').toLowerCase();
    
    // Skip lands
    if (typeLine.includes('land')) {
      continue;
    }
    
    // Skip cards without mana cost (usually special cards)
    const manaCost = card?.mana_cost;
    if (!manaCost) {
      uncostable.push({ name: cardName, manaCost: 'none', reason: 'no mana cost' });
      continue;
    }
    
    // Check if this is an Aura - Auras require a target when cast
    const isAura = typeLine.includes('enchantment') && typeLine.includes('aura');
    if (isAura) {
      // Check if there's a valid target for this Aura
      const hasValidAuraTarget = checkAuraHasValidTarget(game.state, playerId, card);
      if (!hasValidAuraTarget) {
        uncostable.push({ name: cardName, manaCost, reason: 'no valid target for aura' });
        continue;
      }
    }
    
    // Check if this spell requires targets (counterspells, removal, etc.)
    // and verify there are valid targets before considering it castable
    const spellSpec = categorizeSpell(cardName, oracleText);
    if (spellSpec && spellSpec.minTargets > 0) {
      const validTargets = evaluateTargeting(game.state as any, playerId, spellSpec);
      if (validTargets.length < spellSpec.minTargets) {
        uncostable.push({ name: cardName, manaCost, reason: `no valid targets (needs ${spellSpec.minTargets}, found ${validTargets.length})` });
        continue;
      }
    }
    
    // Parse cost using shared function
    const parsedCost = parseManaCost(manaCost);
    const cmc = parsedCost.generic + Object.values(parsedCost.colors).reduce((a, b) => a + b, 0);
    
    // Check if we can afford it using shared function
    if (canPayManaCost(manaPool, parsedCost)) {
      castable.push({
        card,
        cost: parsedCost,
        cmc,
        typeLine,
        priority: calculateSpellPriority(card, game, playerId),
      });
    } else {
      // Log why we can't cast this spell
      uncostable.push({ 
        name: cardName, 
        manaCost, 
        reason: `need ${cmc} mana (have ${totalMana}), colors: ${JSON.stringify(parsedCost.colors)}`
      });
    }
  }
  
  // Log summary
  if (castable.length > 0) {
    debug(1, `[AI] findCastableSpells: Found ${castable.length} castable spell(s):`, 
      castable.map(s => `${s.card.name} (CMC ${s.cmc}, priority ${s.priority})`));
  } else if (uncostable.length > 0) {
    debug(1, `[AI] findCastableSpells: No castable spells. Reasons:`,
      uncostable.slice(0, 5).map(s => `${s.name}: ${s.reason}`));
    if (uncostable.length > 5) {
      debug(1, `[AI] ... and ${uncostable.length - 5} more cards not castable`);
    }
  }
  
  // Sort by priority (highest first)
  castable.sort((a, b) => b.priority - a.priority);
  
  return castable;
}

/**
 * Check if an Aura card has a valid target on the battlefield
 * Parses "Enchant X" patterns to determine what can be targeted
 */
function checkAuraHasValidTarget(state: any, playerId: PlayerID, auraCard: any): boolean {
  const oracleText = (auraCard?.oracle_text || '').toLowerCase();
  const battlefield = state?.battlefield || [];
  
  // Parse "Enchant X" pattern to determine valid targets
  // Common patterns:
  // - "Enchant creature"
  // - "Enchant land"
  // - "Enchant creature you control"
  // - "Enchant creature an opponent controls"
  // - "Enchant artifact"
  // - "Enchant permanent"
  
  const enchantMatch = oracleText.match(/enchant\s+(\w+(?:\s+\w+)*?)(?:\s+you\s+control|\s+an\s+opponent\s+controls)?/i);
  if (!enchantMatch) {
    // No enchant pattern found - assume it can target anything
    return battlefield.length > 0;
  }
  
  const enchantTarget = enchantMatch[1].toLowerCase();
  const youControlOnly = /enchant\s+\w+(?:\s+\w+)*\s+you\s+control/i.test(oracleText);
  const opponentControlOnly = /enchant\s+\w+(?:\s+\w+)*\s+an?\s+opponent\s+controls/i.test(oracleText);
  
  // Find valid targets on the battlefield
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const typeLine = (perm.card.type_line || '').toLowerCase();
    const controller = perm.controller;
    
    // Check controller restrictions
    if (youControlOnly && controller !== playerId) continue;
    if (opponentControlOnly && controller === playerId) continue;
    
    // Check type restrictions
    if (enchantTarget.includes('creature') && !typeLine.includes('creature')) continue;
    if (enchantTarget.includes('land') && !typeLine.includes('land')) continue;
    if (enchantTarget.includes('artifact') && !typeLine.includes('artifact')) continue;
    if (enchantTarget.includes('enchantment') && !typeLine.includes('enchantment')) continue;
    if (enchantTarget.includes('planeswalker') && !typeLine.includes('planeswalker')) continue;
    
    // This permanent matches the enchant restriction
    return true;
  }
  
  return false;
}

/**
 * Find the best target for an Aura spell
 * Uses similar logic to checkAuraHasValidTarget but returns the actual target
 */
function findAuraTarget(state: any, playerId: PlayerID, auraCard: any): any | null {
  const oracleText = (auraCard?.oracle_text || '').toLowerCase();
  const battlefield = state?.battlefield || [];
  
  // Parse "Enchant X" pattern
  const enchantMatch = oracleText.match(/enchant\s+(\w+(?:\s+\w+)*?)(?:\s+you\s+control|\s+an\s+opponent\s+controls)?/i);
  if (!enchantMatch) {
    // No enchant pattern - can target any permanent, prefer own permanents
    const ownPermanents = battlefield.filter((p: any) => p.controller === playerId);
    return ownPermanents[0] || battlefield[0] || null;
  }
  
  const enchantTarget = enchantMatch[1].toLowerCase();
  const youControlOnly = /enchant\s+\w+(?:\s+\w+)*\s+you\s+control/i.test(oracleText);
  const opponentControlOnly = /enchant\s+\w+(?:\s+\w+)*\s+an?\s+opponent\s+controls/i.test(oracleText);
  
  // Determine if this is a beneficial or detrimental aura
  // Beneficial auras should go on own permanents, detrimental on opponents
  const isBeneficial = detectBeneficialAura(oracleText);
  
  const validTargets: any[] = [];
  
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const typeLine = (perm.card.type_line || '').toLowerCase();
    const controller = perm.controller;
    
    // Check controller restrictions
    if (youControlOnly && controller !== playerId) continue;
    if (opponentControlOnly && controller === playerId) continue;
    
    // Check type restrictions
    if (enchantTarget.includes('creature') && !typeLine.includes('creature')) continue;
    if (enchantTarget.includes('land') && !typeLine.includes('land')) continue;
    if (enchantTarget.includes('artifact') && !typeLine.includes('artifact')) continue;
    if (enchantTarget.includes('enchantment') && !typeLine.includes('enchantment')) continue;
    if (enchantTarget.includes('planeswalker') && !typeLine.includes('planeswalker')) continue;
    
    // Add to valid targets with preference marker
    validTargets.push({ perm, isOwn: controller === playerId });
  }
  
  if (validTargets.length === 0) return null;
  
  // Sort by preference: beneficial auras prefer own, detrimental prefer opponent
  validTargets.sort((a, b) => {
    if (isBeneficial) {
      // Prefer own permanents for beneficial auras
      if (a.isOwn && !b.isOwn) return -1;
      if (!a.isOwn && b.isOwn) return 1;
    } else {
      // Prefer opponent permanents for detrimental auras
      if (!a.isOwn && b.isOwn) return -1;
      if (a.isOwn && !b.isOwn) return 1;
    }
    return 0;
  });
  
  return validTargets[0]?.perm || null;
}

/**
 * Detect if an aura is beneficial (buffs) or detrimental (debuffs/control)
 */
function detectBeneficialAura(oracleText: string): boolean {
  const text = oracleText.toLowerCase();
  
  // Detrimental indicators (pacifism, control, debuffs)
  if (text.includes("can't attack") || text.includes("can't block")) return false;
  if (text.includes("doesn't untap")) return false;
  if (text.includes("gains control")) return false;
  if (text.includes("-1/-1") || text.includes("-2/-2") || text.includes("-3/-3")) return false;
  if (text.includes("exile") && text.includes("when")) return false;
  if (text.includes("destroy") && text.includes("when")) return false;
  if (text.includes("goaded") || text.includes("is goaded")) return false;
  
  // Beneficial indicators (buffs, abilities)
  if (text.includes("+1/+1") || text.includes("+2/+2") || text.includes("+3/+3")) return true;
  if (text.includes("flying") || text.includes("trample") || text.includes("lifelink")) return true;
  if (text.includes("first strike") || text.includes("double strike") || text.includes("vigilance")) return true;
  if (text.includes("hexproof") || text.includes("indestructible") || text.includes("protection")) return true;
  if (text.includes("create a") && text.includes("token")) return true; // Squirrel Nest, etc.
  if (text.includes("whenever") && text.includes("draw")) return true;
  
  // Default to beneficial for enchantments on your own stuff
  return true;
}

/**
 * Find castable commander from command zone
 * Returns the commander card and cost if castable, null otherwise
 * Uses shared mana calculation for consistency
 * 
 * Partner commanders and backgrounds are tracked independently - each can be cast
 * while the other remains in the command zone.
 */
function findCastableCommander(game: any, playerId: PlayerID): { card: any; cost: any; isBackground?: boolean } | null {
  const commandZone = game.state?.commandZone?.[playerId];
  if (!commandZone) return null;
  
  const commanderIds = commandZone.commanderIds || [];
  // Use commanderCards (the correct field name) instead of commanders
  const commanderCards = commandZone.commanderCards || commandZone.commanders || [];
  // Check which commanders are actually in the command zone (important for partner commanders)
  const inCommandZone = commandZone.inCommandZone || commanderIds;
  // Use per-commander tax (taxById) instead of a single tax value
  const taxById = commandZone.taxById || {};
  
  if (inCommandZone.length === 0 || commanderCards.length === 0) return null;
  
  // Use shared mana calculation
  const manaPool = getAvailableMana(game.state, playerId);
  
  // Check each commander that is still in the command zone
  for (const commanderId of inCommandZone) {
    // Find the commander card
    const card = commanderCards.find((c: any) => c?.id === commanderId || c?.name === commanderId);
    if (!card) continue;
    
    // Check if commander is already on battlefield or stack (shouldn't happen if inCommandZone is correct)
    const battlefield = game.state?.battlefield || [];
    const stack = game.state?.stack || [];
    const onBattlefield = battlefield.some((p: any) => 
      p.card?.id === commanderId || 
      p.card?.name === card.name ||
      (p.isCommander && p.controller === playerId && p.card?.name === card.name)
    );
    const onStack = stack.some((s: any) => 
      s.card?.id === commanderId ||
      (s.isCommander && s.controller === playerId && s.card?.name === card.name)
    );
    
    if (onBattlefield || onStack) continue;
    
    // Get base mana cost
    const manaCost = card.mana_cost;
    if (!manaCost) continue;
    
    // Parse cost with commander tax using per-commander tax
    const parsedCost = parseManaCost(manaCost);
    const commanderTax = taxById[commanderId] || 0;
    const totalCost = {
      ...parsedCost,
      generic: parsedCost.generic + commanderTax,
    };
    
    // Check if we can afford it using shared function
    if (canPayManaCost(manaPool, totalCost)) {
      const typeLine = (card.type_line || '').toLowerCase();
      const isBackground = typeLine.includes('background');
      const cmc = totalCost.generic + Object.values(totalCost.colors).reduce((a, b) => a + b, 0);
      
      debug(1, '[AI] Found castable commander:', card.name, 'with tax:', commanderTax, 'total CMC:', cmc);
      return { card, cost: totalCost, isBackground };
    }
  }
  
  return null;
}

/**
 * Calculate priority for casting a spell (higher = cast first)
 * 
 * Priority system:
 * - Base: 50
 * - Mana rocks/dorks: +40 (early acceleration is crucial in Commander)
 * - Creatures: +30 (board presence)
 * - Artifacts/Enchantments: +20 (value permanents)
 * - Removal: +25 (interaction)
 * - Card draw: +20 (card advantage)
 * - Ramp spells: +15 (acceleration)
 * - CMC curve bonus: 0-10 (prefer cheaper spells)
 */
function calculateSpellPriority(card: any, game: any, playerId: PlayerID): number {
  let priority = 50; // Base priority
  const typeLine = (card?.type_line || '').toLowerCase();
  const oracleText = (card?.oracle_text || '').toLowerCase();
  const cardName = (card?.name || '').toLowerCase();
  
  // Calculate CMC first - needed for early-game mana rock priority
  const parsedCost = parseManaCost(card?.mana_cost || '');
  const cmc = parsedCost.generic + Object.values(parsedCost.colors).reduce((a, b) => a + b, 0);
  
  // MANA ROCKS: Extremely high priority in early game
  // Cards that produce mana are crucial for acceleration
  // Detect mana ability patterns: "{T}: Add", "add one mana of any color", etc.
  const isManaRock = (
    typeLine.includes('artifact') &&
    (
      oracleText.includes('add {') || 
      oracleText.includes('add one mana') || 
      oracleText.includes('add mana') ||
      oracleText.includes('add x mana') ||
      // Known mana rocks by name
      cardName.includes('sol ring') ||
      cardName.includes('mana crypt') ||
      cardName.includes('mana vault') ||
      cardName.includes('arcane signet') ||
      cardName.includes('signet') ||
      cardName.includes('talisman') ||
      cardName.includes('mind stone') ||
      cardName.includes('fellwar stone') ||
      cardName.includes('thought vessel') ||
      cardName.includes('commander\'s sphere') ||
      cardName.includes('chromatic lantern') ||
      cardName.includes('gilded lotus') ||
      cardName.includes('thran dynamo') ||
      cardName.includes('worn powerstone') ||
      cardName.includes('hedron archive') ||
      cardName.includes('coalition relic') ||
      cardName.includes('darksteel ingot') ||
      cardName.includes('prismatic geoscope') ||
      cardName.includes('skyclave relic') ||
      cardName.includes('everflowing chalice') ||
      cardName.includes('astral cornucopia')
    )
  );
  
  // Domain mana rocks (Prismatic Geoscope) produce more mana the more basic land types you control
  const isDomainManaRock = oracleText.includes('domain') && isManaRock;
  
  if (isManaRock) {
    // Mana rocks get highest priority in early game
    // The cheaper they are, the more valuable
    priority += 40;
    // Extra priority for cheap mana rocks (0-2 CMC are best)
    if (cmc <= 2) {
      priority += 15; // Sol Ring, Arcane Signet, Signets, Talismans, etc.
    } else if (cmc <= 3) {
      priority += 10; // Chromatic Lantern, Coalition Relic, etc.
    } else if (cmc >= 5) {
      // High-CMC mana rocks like Prismatic Geoscope (5 CMC) are still valuable
      // but should be cast after cheaper rocks are out
      priority += 5;
    }
    
    // Domain-based mana rocks are very powerful in 5-color decks
    if (isDomainManaRock) {
      priority += 5;
    }
  }
  
  // MANA DORKS: Creatures that produce mana
  const isManaDork = (
    typeLine.includes('creature') &&
    (
      oracleText.includes('{t}: add') ||
      oracleText.includes('tap: add') ||
      // Known mana dorks by name
      cardName.includes('llanowar elves') ||
      cardName.includes('elvish mystic') ||
      cardName.includes('birds of paradise') ||
      cardName.includes('noble hierarch') ||
      cardName.includes('avacyn\'s pilgrim') ||
      cardName.includes('elves of deep shadow') ||
      cardName.includes('deathrite shaman') ||
      cardName.includes('bloom tender') ||
      cardName.includes('priest of titania') ||
      cardName.includes('elvish archdruid')
    )
  );
  
  if (isManaDork) {
    priority += 35; // High priority for mana acceleration
    if (cmc === 1) {
      priority += 15; // 1-CMC dorks are excellent
    }
  }
  
  // Creatures are good for board presence (non-dork creatures)
  if (typeLine.includes('creature') && !isManaDork) {
    priority += 30;
  }
  
  // Artifacts and enchantments that help are good (non-mana-rock artifacts)
  if ((typeLine.includes('artifact') || typeLine.includes('enchantment')) && !isManaRock) {
    priority += 20;
  }
  
  // Removal spells are valuable
  if (oracleText.includes('destroy') || oracleText.includes('exile')) {
    priority += 25;
  }
  
  // Card draw is valuable
  if (oracleText.includes('draw') && oracleText.includes('card')) {
    priority += 20;
  }
  
  // Ramp spells are valuable early (land ramp)
  if (oracleText.includes('search your library') && oracleText.includes('land')) {
    priority += 15;
  }
  
  // Lower CMC spells get slight priority (play on curve)
  priority += Math.max(0, 10 - cmc);
  
  return priority;
}

/**
 * Get untapped mana sources (lands, artifacts, creatures) that can pay for a spell
 * Returns source IDs in the order they should be tapped, with the color each should produce
 */
function getPaymentSources(game: any, playerId: PlayerID, cost: { colors: Record<string, number>; generic: number }): Array<{ sourceId: string; produceColor: string }> {
  const battlefield = game.state?.battlefield || [];
  const payments: Array<{ sourceId: string; produceColor: string }> = [];
  const usedSourceIds = new Set<string>(); // Track which sources we've already assigned
  const colorsPaid: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  let genericPaid = 0;
  
  // Collect all available mana sources with their produced colors
  const availableSources: Array<{ perm: any; producedColors: string[]; isLand: boolean; producesTwoMana: boolean }> = [];
  for (const perm of battlefield) {
    if (perm && perm.controller === playerId && !perm.tapped) {
      // Check if this permanent can produce mana
      if (!hasManaAbility(perm.card)) continue;
      
      // Creatures with summoning sickness can't tap for mana
      if (hasCreatureSummoningSickness(perm)) continue;
      
      const producedColors = getManaProduction(perm.card);
      if (producedColors.length === 0) continue;
      
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      const oracleText = (perm.card?.oracle_text || '').toLowerCase();
      const isLand = typeLine.includes('land');
      const producesTwoMana = oracleText.includes('{c}{c}') || oracleText.includes('add {c}{c}');
      
      availableSources.push({ perm, producedColors, isLand, producesTwoMana });
    }
  }
  
  // First pass: assign sources to colored requirements
  // Prefer single-color sources for specific colors to save multi-color sources for flexibility
  // Also prefer lands over mana rocks/creatures for colored mana
  for (const [color, needed] of Object.entries(cost.colors)) {
    if (needed <= 0) continue;
    
    while (colorsPaid[color] < needed) {
      // Find an unassigned source that can produce this color
      // Priority: single-color land > single-color artifact > multi-color land > multi-color artifact
      let bestSource: { perm: any; producedColors: string[]; isLand: boolean; producesTwoMana: boolean } | null = null;
      let bestScore = -1;
      
      for (const source of availableSources) {
        if (usedSourceIds.has(source.perm.id)) continue;
        if (!source.producedColors.includes(color)) continue;
        
        // Score: prefer single-color lands, then single-color artifacts, then multi
        let score = 0;
        if (source.producedColors.length === 1) score += 10; // Single color is better
        if (source.isLand) score += 5; // Lands are slightly preferred over rocks
        
        if (score > bestScore) {
          bestScore = score;
          bestSource = source;
        }
      }
      
      if (bestSource) {
        usedSourceIds.add(bestSource.perm.id);
        payments.push({ sourceId: bestSource.perm.id, produceColor: color });
        colorsPaid[color]++;
      } else {
        break; // No more sources available for this color
      }
    }
  }
  
  // Second pass: assign remaining sources to generic mana
  // For sources that produce 2 mana (Sol Ring), they count for 2 generic
  let genericNeeded = cost.generic;
  for (const source of availableSources) {
    if (genericNeeded <= 0) break;
    if (usedSourceIds.has(source.perm.id)) continue;
    
    usedSourceIds.add(source.perm.id);
    // Use the first produced color (or colorless)
    const color = source.producedColors[0] || 'C';
    payments.push({ sourceId: source.perm.id, produceColor: color });
    
    // Sol Ring type sources pay for 2 generic
    genericNeeded -= source.producesTwoMana ? 2 : 1;
  }
  
  return payments;
}

/**
 * Check the maximum hand size for a player (considering "no maximum hand size" effects)
 */
function getAIMaxHandSize(game: any, playerId: PlayerID): number {
  const battlefield = game.state?.battlefield || [];
  
  // Check for permanents that grant "no maximum hand size"
  for (const perm of battlefield) {
    if (perm && perm.controller === playerId) {
      const oracle = (perm.card?.oracle_text || '').toLowerCase();
      if (oracle.includes('you have no maximum hand size')) {
        return Infinity;
      }
    }
  }
  
  return 7; // Default maximum hand size
}

/**
 * Check if AI needs to discard cards during cleanup
 */
function needsToDiscard(game: any, playerId: PlayerID): { needsDiscard: boolean; discardCount: number } {
  const zones = game.state?.zones?.[playerId];
  const handSize = zones?.handCount ?? (Array.isArray(zones?.hand) ? zones.hand.length : 0);
  const maxHandSize = getAIMaxHandSize(game, playerId);
  
  if (maxHandSize === Infinity) {
    return { needsDiscard: false, discardCount: 0 };
  }
  
  const discardCount = Math.max(0, handSize - maxHandSize);
  return { needsDiscard: discardCount > 0, discardCount };
}

/**
 * Choose cards for AI to discard - prioritizes keeping castable and valuable spells
 * 
 * Priority for KEEPING (higher score = keep):
 * - Lands: +100 (always valuable)
 * - Castable spells (can be cast next turn): +50
 * - Removal spells: +30
 * - Creatures: +20
 * - Low-CMC spells: +10 - CMC (easier to cast)
 * 
 * The AI should discard high-CMC spells it can't cast rather than
 * castable spells, even if those spells are technically "better"
 */
function chooseCardsToDiscard(game: any, playerId: PlayerID, discardCount: number): string[] {
  const zones = game.state?.zones?.[playerId];
  const hand = Array.isArray(zones?.hand) ? zones.hand : [];
  
  if (hand.length <= discardCount) {
    return hand.map((c: any) => c.id);
  }
  
  // Calculate available mana to determine castability
  const manaPool = getAvailableMana(game.state, playerId);
  const totalAvailableMana = getTotalManaFromPool(manaPool);
  
  // Score cards - lower score = more likely to discard
  const scoredCards = hand.map((card: any) => {
    let score = 50; // Base score
    const typeLine = (card?.type_line || '').toLowerCase();
    const manaCost = card?.mana_cost || '';
    const oracleText = (card?.oracle_text || '').toLowerCase();
    
    // Keep lands (highest priority)
    if (typeLine.includes('land')) {
      score += 100;
      return { card, score };
    }
    
    // Calculate CMC
    const parsedCost = parseManaCost(manaCost);
    const cmc = parsedCost.generic + Object.values(parsedCost.colors).reduce((a, b) => a + b, 0);
    
    // CASTABILITY CHECK: Strongly prefer keeping castable spells
    // A spell is "castable" if the AI can afford it with current/potential mana
    // Add +2 mana buffer for "next turn" (likely land drop)
    const canCastSoon = cmc <= totalAvailableMana + 2;
    const canCastNow = canPayManaCost(manaPool, parsedCost);
    
    if (canCastNow) {
      score += 60; // Can cast right now - definitely keep
    } else if (canCastSoon) {
      score += 40; // Can likely cast next turn - prefer to keep
    } else if (cmc > totalAvailableMana + 4) {
      score -= 30; // Very expensive spell we can't cast for a while - consider discarding
    }
    
    // Keep low-cost spells (easier to cast)
    score += Math.max(0, 10 - cmc);
    
    // Keep creatures (good for board presence)
    if (typeLine.includes('creature')) {
      score += 20;
    }
    
    // Keep removal spells (interaction is important)
    if (oracleText.includes('destroy') || oracleText.includes('exile')) {
      score += 30;
    }
    
    // Keep mana rocks/ramp (acceleration)
    if (typeLine.includes('artifact') && (oracleText.includes('add {') || oracleText.includes('add one mana'))) {
      score += 35;
    }
    
    // Keep card draw spells
    if (oracleText.includes('draw') && (oracleText.includes('card') || oracleText.includes('cards'))) {
      score += 25;
    }
    
    return { card, score };
  });
  
  // Sort by score (ascending) - lowest scores first (to discard)
  scoredCards.sort((a: any, b: any) => a.score - b.score);
  
  // Return the IDs of the cards with lowest scores
  return scoredCards.slice(0, discardCount).map((sc: any) => sc.card.id);
}

/**
 * Handle AI turn when it's an AI player's priority
 * This is the main AI decision-making function that handles:
 * - Playing lands
 * - Casting spells
 * - Advancing steps
 * - Discarding during cleanup
 * - Passing turn to next player
 */
export async function handleAIPriority(
  io: Server,
  gameId: string,
  playerId: PlayerID
): Promise<void> {
  if (!isAIPlayer(gameId, playerId)) {
    return;
  }
  
  const game = ensureGame(gameId);
  if (!game || !game.state) {
    debugWarn(2, '[AI] handleAIPriority: game not found', { gameId, playerId });
    return;
  }
  
  // Check if this AI player has lost the game
  const players = game.state.players || [];
  const aiPlayer = players.find((p: any) => p.id === playerId);
  if (aiPlayer?.hasLost) {
    debug(1, '[AI] AI player has lost the game, skipping priority handling:', { gameId, playerId });
    return;
  }
  
  // Check if this AI player is in the inactive set
  const ctx = (game as any).ctx || game;
  const inactiveSet = ctx.inactive instanceof Set ? ctx.inactive : new Set();
  if (inactiveSet.has(playerId)) {
    debug(1, '[AI] AI player is inactive, skipping priority handling:', { gameId, playerId });
    return;
  }
  
  // CRITICAL FIX: Check if THIS AI player has pending resolution steps
  // This is a player-specific check using playerHasPendingSteps(), which only looks at
  // steps assigned to this particular AI. This prevents the AI from acting while it's
  // waiting for its own modal responses (bounce land choice, Join Forces, etc.).
  // Note: The priority module (priority.ts) uses getPendingSummary() to check for ANY
  // pending steps across ALL players, which enforces MTG Rule 608.2 more broadly.
  if (ResolutionQueueManager.playerHasPendingSteps(gameId, playerId)) {
    debug(1, '[AI] AI player has pending resolution steps, skipping priority handling:', { gameId, playerId });
    return;
  }
  
  const phase = String(game.state.phase || '').toLowerCase();
  const step = String((game.state as any).step || '').toLowerCase();
  const isAITurn = game.state.turnPlayer === playerId;
  const stackEmpty = !game.state.stack || game.state.stack.length === 0;
  const hasPriority = game.state.priority === playerId;
  
  debug(1, '[AI] AI player checking priority:', { 
    gameId, 
    playerId, 
    phase, 
    step, 
    isAITurn, 
    stackEmpty,
    priority: game.state.priority,
    hasPriority
  });
  
  // CRITICAL: Cleanup step does NOT receive priority (Rule 514.1)
  // Cleanup happens automatically: discard to hand size, remove damage, end "until end of turn" effects
  // AI only acts during cleanup on its own turn to handle automatic actions
  if (step.includes('cleanup') || step === 'cleanup') {
    debug(1, '[AI] Cleanup step - handling automatic cleanup actions (Rule 514.1)');
    
    // Only handle cleanup if it's the AI's turn
    // (Cleanup doesn't grant priority per Rule 514.1, so we only act if we're the turn player)
    if (isAITurn) {
      // Check if we're already processing cleanup for this AI to prevent double-execution
      const processingCleanup = (game.state as any)._aiProcessingCleanup?.[playerId];
      if (processingCleanup) {
        debug(1, '[AI] Cleanup step - already processing cleanup for this AI, skipping to prevent double-execution');
        return;
      }
      
      // Mark that we're processing cleanup for this AI
      (game.state as any)._aiProcessingCleanup = (game.state as any)._aiProcessingCleanup || {};
      (game.state as any)._aiProcessingCleanup[playerId] = true;
      
      // CRITICAL: Check pendingDiscardSelection first (set by game engine during nextStep)
      // This is the authoritative source for cleanup discard requirements
      const pendingDiscard = (game.state as any).pendingDiscardSelection?.[playerId];
      let discardCount = 0;
      
      if (pendingDiscard && pendingDiscard.count > 0) {
        debug(1, '[AI] Cleanup step - AI has pending discard selection:', pendingDiscard.count, 'cards');
        discardCount = pendingDiscard.count;
      } else {
        // Fallback: calculate discard need independently (in case pendingDiscardSelection wasn't set)
        const { needsDiscard, discardCount: calculatedCount } = needsToDiscard(game, playerId);
        if (needsDiscard) {
          debug(1, '[AI] Cleanup step - AI needs to discard', calculatedCount, 'cards (calculated independently)');
          discardCount = calculatedCount;
        }
      }
      
      if (discardCount > 0) {
        await executeAIDiscard(io, gameId, playerId, discardCount);
        // Clear the processing flag after discard
        if ((game.state as any)._aiProcessingCleanup) {
          delete (game.state as any)._aiProcessingCleanup[playerId];
        }
        return;
      }
      
      // No discard needed - cleanup is complete, auto-advance
      debug(1, '[AI] Cleanup step - no discard needed, auto-advancing');
      await executeAdvanceStep(io, gameId, playerId);
      
      // Clear the processing flag after advancing
      if ((game.state as any)._aiProcessingCleanup) {
        delete (game.state as any)._aiProcessingCleanup[playerId];
      }
      return;
    } else {
      // Not AI's turn - don't act during cleanup (per Rule 514.1, cleanup doesn't grant priority)
      debug(1, '[AI] Cleanup step - not AI turn, skipping');
      return;
    }
  }
  
  // Critical check: AI should NOT act if it doesn't have priority
  // This prevents the AI from getting into an infinite loop of passing priority
  // and prevents the AI from advancing during opponent's turn
  if (!hasPriority) {
    debug(1, '[AI] AI does not have priority, skipping action');
    return;
  }
  
  debug(1, '[AI] AI has priority, proceeding with action');
  
  try {
    // CRITICAL: Check for pending trigger ordering BEFORE any other action
    // This prevents the AI from getting stuck in an infinite loop trying to advance
    // while trigger ordering is pending
    const pendingTriggerOrdering = (game.state as any).pendingTriggerOrdering?.[playerId];
    if (pendingTriggerOrdering) {
      debug(1, '[AI] AI has pending trigger ordering, auto-ordering triggers');
      await executeAITriggerOrdering(io, gameId, playerId);
      return; // After ordering triggers, we'll get called again via broadcastGame
    }
    
    // Also check for triggers in the trigger queue that need ordering
    const triggerQueue = (game.state as any).triggerQueue || [];
    const aiTriggers = triggerQueue.filter((t: any) => 
      t.controllerId === playerId && t.type === 'order'
    );
    if (aiTriggers.length >= 2) {
      debug(1, `[AI] AI has ${aiTriggers.length} triggers to order in queue`);
      await executeAITriggerOrdering(io, gameId, playerId);
      return;
    }
    
    // Check for pending Kynaios and Tiro style choice
    // AI should automatically make a decision (play land if available, otherwise decline/draw)
    const pendingKynaiosChoice = (game.state as any).pendingKynaiosChoice;
    if (pendingKynaiosChoice) {
      for (const [controllerId, choiceData] of Object.entries(pendingKynaiosChoice)) {
        const choice = choiceData as any;
        if (!choice.active) continue;
        
        const playersWhoMayPlayLand = choice.playersWhoMayPlayLand || [];
        const playersWhoPlayedLand = choice.playersWhoPlayedLand || [];
        const playersWhoDeclined = choice.playersWhoDeclined || [];
        
        // Check if AI needs to make a choice
        if (playersWhoMayPlayLand.includes(playerId) &&
            !playersWhoPlayedLand.includes(playerId) &&
            !playersWhoDeclined.includes(playerId)) {
          
          debug(1, `[AI] AI ${playerId} has pending Kynaios choice, making decision`);
          await executeAIKynaiosChoice(io, gameId, playerId, controllerId, choice);
          return;
        }
      }
    }
    
    // CRITICAL: Check for stuck pendingSpellCasts that could cause infinite loops
    // This can happen when a spell with targets gets stuck in the targeting workflow
    // Clean up any pendingSpellCasts that belong to this AI player
    const pendingSpellCasts = (game.state as any).pendingSpellCasts || {};
    const aiPendingCasts = Object.keys(pendingSpellCasts).filter(effectId => 
      pendingSpellCasts[effectId]?.playerId === playerId
    );
    if (aiPendingCasts.length > 0) {
      debugWarn(2, `[AI] Cleaning up ${aiPendingCasts.length} stuck pending spell cast(s) to prevent infinite loop`);
      for (const effectId of aiPendingCasts) {
        const castInfo = pendingSpellCasts[effectId];
        debugWarn(2, `[AI] Removing stuck spell cast: ${castInfo?.cardName || 'unknown'} (effectId: ${effectId})`);
        delete pendingSpellCasts[effectId];
      }
      // After cleanup, broadcast state and return - next AI action will proceed normally
      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }
      broadcastGame(io, game, gameId);
      return;
    }
    
    // If it's not the AI's turn, handle special cases where non-turn player needs to act
    if (!isAITurn) {
      // DECLARE_BLOCKERS step: The defending player (non-turn player) needs to declare blockers
      if (phase === 'combat' && (step.includes('blockers') || step === 'declare_blockers')) {
        debug(1, '[AI] Not AI turn, but it\'s DECLARE_BLOCKERS step - AI needs to decide on blockers');
        
        // Check if blockers have already been declared this step
        const battlefield = game.state?.battlefield || [];
        const alreadyDeclaredBlockers = battlefield.some((perm: any) => 
          perm.controller === playerId && Array.isArray(perm.blocking) && perm.blocking.length > 0
        );
        
        if (!alreadyDeclaredBlockers) {
          // AI needs to declare blockers
          // Get the attacking creatures from the battlefield
          const attackingCreatures = battlefield.filter((perm: any) => 
            perm.attacking === true
          );
          
          const context: AIDecisionContext = {
            gameState: game.state as any,
            playerId,
            decisionType: AIDecisionType.DECLARE_BLOCKERS,
            options: [],
            constraints: {
              attackers: attackingCreatures,
            },
          };
          
          const decision = await aiEngine.makeDecision(context);
          
          if (decision.action?.blockers?.length > 0) {
            await executeDeclareBlockers(io, gameId, playerId, decision.action.blockers);
            return;
          }
          // No blockers to declare - fall through to pass priority
        }
      }
      
      // Default behavior for non-turn player: pass priority
      debug(1, '[AI] Not AI turn, passing priority');
      await executePassPriority(io, gameId, playerId);
      return;
    }
    
    // If there's something on the stack, let it resolve
    if (!stackEmpty) {
      debug(1, '[AI] Stack not empty, passing priority to let it resolve');
      await executePassPriority(io, gameId, playerId);
      return;
    }
    
    // Handle different phases/steps
    
    // MAIN PHASES: Play lands and cast spells
    const isMainPhase = phase.includes('main') || step.includes('main');
    
    if (isMainPhase) {
      // Check if AI will need to discard at end of turn (hand size > 7)
      // If so, be more aggressive about casting spells
      const zones = game.state?.zones?.[playerId];
      const handSize = Array.isArray(zones?.hand) ? zones.hand.length : 0;
      const maxHandSize = getAIMaxHandSize(game, playerId);
      const willNeedToDiscard = handSize > maxHandSize;
      
      if (willNeedToDiscard) {
        debug(1, `[AI] Hand size ${handSize} exceeds max ${maxHandSize} - will prioritize casting spells to avoid discarding`);
      }
      
      // Try to play a land first
      if (canAIPlayLand(game, playerId)) {
        const landCard = findPlayableLand(game, playerId);
        if (landCard) {
          debug(1, '[AI] Playing land:', landCard.name);
          await executeAIPlayLand(io, gameId, playerId, landCard.id);
          // After playing land, continue with more actions
          setTimeout(() => {
            handleAIPriority(io, gameId, playerId).catch(err => debugError(1, err));
          }, AI_THINK_TIME_MS);
          return;
        } else {
          debug(1, '[AI] No land found in hand to play');
        }
      } else {
        // Debug why we can't play a land
        const landsPlayed = game.state?.landsPlayedThisTurn?.[playerId] || 0;
        const maxLands = ((game as any).maxLandsPerTurn?.[playerId] ?? (game.state as any)?.maxLandsPerTurn?.[playerId]) || 1;
        debug(1, '[AI] Cannot play land:', { 
          isMainPhase, 
          isAITurn, 
          landsPlayed, 
          maxLands,
          reason: !isMainPhase ? 'not main phase' : !isAITurn ? 'not AI turn' : 'already played max lands'
        });
      }
      
      // IMPORTANT: Tap lands for mana retention effects BEFORE combat
      // This is critical for cards like Omnath, Locus of Mana which gain power from green mana in pool
      // By tapping green-producing lands now, Omnath will be stronger during the combat phase
      const shouldTapLands = checkShouldTapLandsForManaRetention(game, playerId);
      if (shouldTapLands.shouldTap) {
        debug(1, `[AI] Tapping lands for mana retention before combat (${shouldTapLands.reason})`);
        await executeAITapLandsForMana(io, gameId, playerId);
        // After tapping lands, continue with more actions (in case we can now cast something)
        setTimeout(() => {
          handleAIPriority(io, gameId, playerId).catch(err => debugError(1, err));
        }, AI_THINK_TIME_MS);
        return;
      }
      
      // Try to use activated abilities (before casting spells)
      // This prioritizes card draw and other beneficial effects
      // BUT: Skip if we need to discard - prioritize casting spells instead
      if (!willNeedToDiscard) {
        const abilityDecision = await aiEngine.makeDecision({
          gameState: game.state as any,
          playerId,
          decisionType: AIDecisionType.ACTIVATE_ABILITY,
          options: [],
        });
        
        if (abilityDecision.action?.activate) {
          debug(1, '[AI] Activating ability:', abilityDecision.action.cardName, '-', abilityDecision.reasoning);
          await executeAIActivateAbility(io, gameId, playerId, abilityDecision.action);
          // After activating ability, continue with more actions
          setTimeout(() => {
            handleAIPriority(io, gameId, playerId).catch(err => debugError(1, err));
          }, AI_THINK_TIME_MS);
          return;
        }
      }
      
      // Try to cast commanders from command zone
      const commanderCastResult = findCastableCommander(game, playerId);
      if (commanderCastResult) {
        debug(1, '[AI] Casting commander from command zone:', commanderCastResult.card.name);
        await executeAICastCommander(io, gameId, playerId, commanderCastResult.card, commanderCastResult.cost);
        // After casting, continue with more actions
        setTimeout(() => {
          handleAIPriority(io, gameId, playerId).catch(err => debugError(1, err));
        }, AI_THINK_TIME_MS);
        return;
      }
      
      // Try to cast spells from hand
      // If we need to discard, we should cast ANY spell we can afford, not just optimal ones
      const castableSpells = findCastableSpells(game, playerId);
      if (castableSpells.length > 0) {
        const bestSpell = castableSpells[0]; // Already sorted by priority
        
        // If we will need to discard, log the urgency
        if (willNeedToDiscard) {
          debug(1, `[AI] Casting spell to avoid discard: ${bestSpell.card.name} (hand: ${handSize}/${maxHandSize})`);
        } else {
          debug(1, '[AI] Casting spell:', bestSpell.card.name, 'with priority', bestSpell.priority);
        }
        
        await executeAICastSpell(io, gameId, playerId, bestSpell.card, bestSpell.cost);
        // After casting, continue with more actions
        setTimeout(() => {
          handleAIPriority(io, gameId, playerId).catch(err => debugError(1, err));
        }, AI_THINK_TIME_MS);
        return;
      }
      
      // If we still need to discard and couldn't cast anything, try activated abilities now
      // (we skipped them earlier to prioritize spells)
      if (willNeedToDiscard) {
        const abilityDecision = await aiEngine.makeDecision({
          gameState: game.state as any,
          playerId,
          decisionType: AIDecisionType.ACTIVATE_ABILITY,
          options: [],
        });
        
        if (abilityDecision.action?.activate) {
          debug(1, '[AI] Activating ability (after spell attempts):', abilityDecision.action.cardName);
          await executeAIActivateAbility(io, gameId, playerId, abilityDecision.action);
          setTimeout(() => {
            handleAIPriority(io, gameId, playerId).catch(err => debugError(1, err));
          }, AI_THINK_TIME_MS);
          return;
        }
      }
      
      // No more actions, pass priority (don't advance step directly - let priority system handle it)
      // This allows other players to get priority and potentially take actions
      // The step will advance automatically when all players pass priority
      debug(1, '[AI] Main phase, no more actions, passing priority');
      await executePassPriority(io, gameId, playerId);
      return;
    }
    
    // COMBAT PHASES: Handle attack/block declarations
    if (phase === 'combat') {
      if (step.includes('attackers') || step === 'declare_attackers') {
        // Check if attackers have already been declared this step
        // by looking for any creatures marked as attacking
        const battlefield = game.state?.battlefield || [];
        const alreadyDeclaredAttackers = battlefield.some((perm: any) => 
          perm.controller === playerId && perm.attacking
        );
        
        if (alreadyDeclaredAttackers) {
          // Attackers already declared, just pass priority to allow responses
          debug(1, '[AI] Attackers already declared, passing priority for responses');
          await executePassPriority(io, gameId, playerId);
          return;
        }
        
        // Determine what type of decision is needed
        const context: AIDecisionContext = {
          gameState: game.state as any,
          playerId,
          decisionType: AIDecisionType.DECLARE_ATTACKERS,
          options: [],
        };
        
        const decision = await aiEngine.makeDecision(context);
        
        if (decision.action?.attackers?.length > 0) {
          await executeDeclareAttackers(io, gameId, playerId, decision.action.attackers);
        } else {
          // No attackers, pass priority (step will advance when all players pass)
          debug(1, '[AI] No attackers to declare, passing priority');
          await executePassPriority(io, gameId, playerId);
        }
        return;
      }
      
      if (step.includes('blockers') || step === 'declare_blockers') {
        // Check if blockers have already been declared this step
        // by looking for any creatures marked as blocking
        const battlefield = game.state?.battlefield || [];
        const alreadyDeclaredBlockers = battlefield.some((perm: any) => 
          perm.controller === playerId && Array.isArray(perm.blocking) && perm.blocking.length > 0
        );
        
        if (alreadyDeclaredBlockers) {
          // Blockers already declared, just pass priority to allow responses
          debug(1, '[AI] Blockers already declared, passing priority for responses');
          await executePassPriority(io, gameId, playerId);
          return;
        }
        
        // Get the attacking creatures from the battlefield
        const attackingCreatures = battlefield.filter((perm: any) => 
          perm.attacking === true
        );
        
        const context: AIDecisionContext = {
          gameState: game.state as any,
          playerId,
          decisionType: AIDecisionType.DECLARE_BLOCKERS,
          options: [],
          constraints: {
            attackers: attackingCreatures,
          },
        };
        
        const decision = await aiEngine.makeDecision(context);
        
        if (decision.action?.blockers?.length > 0) {
          await executeDeclareBlockers(io, gameId, playerId, decision.action.blockers);
        } else {
          // No blockers, pass priority (step will advance when all players pass)
          debug(1, '[AI] No blockers to declare, passing priority');
          await executePassPriority(io, gameId, playerId);
        }
        return;
      }
      
      // Other combat steps - just pass priority (only active player can advance combat)
      debug(1, '[AI] Combat step', step, '- passing priority');
      await executePassPriority(io, gameId, playerId);
      return;
    }
    
    // BEGINNING PHASES (Untap, Upkeep, Draw) - only active player can advance
    if (phase === 'beginning' || phase.includes('begin')) {
      debug(1, '[AI] Beginning phase, step:', step, '- passing priority');
      await executePassPriority(io, gameId, playerId);
      return;
    }
    
    // ENDING PHASE (End step) - only active player can advance
    if (phase === 'ending' || phase === 'end') {
      debug(1, '[AI] Ending phase, step:', step, '- passing priority');
      await executePassPriority(io, gameId, playerId);
      return;
    }
    
    // Default: pass priority instead of advancing (let the game engine handle step advancement)
    debug(1, '[AI] Unknown phase/step, passing priority');
    await executePassPriority(io, gameId, playerId);
    
  } catch (error) {
    debugError(1, '[AI] Error handling AI priority:', error);
    // Fallback: try to advance step or pass priority
    try {
      if (isAITurn && stackEmpty) {
        await executeAdvanceStep(io, gameId, playerId);
      } else {
        await executePassPriority(io, gameId, playerId);
      }
    } catch (e) {
      debugError(1, '[AI] Failed fallback action:', e);
    }
  }
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
  if (oracleText.includes('enters the battlefield tapped') && 
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
 * Check if AI should tap lands for mana due to mana retention effects
 * Returns { shouldTap: boolean, reason: string }
 */
function checkShouldTapLandsForManaRetention(game: any, playerId: PlayerID): { shouldTap: boolean; reason: string } {
  const battlefield = game.state?.battlefield || [];
  
  // Check for mana retention effects
  let hasGreenRetention = false;
  let hasRedRetention = false;
  let hasAllRetention = false;
  let hasColorlessConversion = false;
  
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId) continue;
    
    const cardName = (perm.card?.name || '').toLowerCase();
    const oracleText = (perm.card?.oracle_text || '').toLowerCase();
    
    // Omnath, Locus of Mana - Green mana doesn't empty
    // Oracle text: "You don't lose unspent green mana as steps and phases end."
    // Handle different apostrophe styles and text variations
    if (cardName.includes('omnath, locus of mana') || 
        (oracleText.includes('green mana') && 
         (oracleText.includes("doesn't empty") || oracleText.includes("doesn't empty") ||
          oracleText.includes("don't lose") || oracleText.includes("don't lose")))) {
      hasGreenRetention = true;
    }
    
    // Leyline Tyrant - Red mana doesn't empty
    // Oracle text: "You don't lose unspent red mana as steps and phases end."
    // Handle different apostrophe styles and text variations
    if (cardName.includes('leyline tyrant') ||
        (oracleText.includes('red mana') && 
         (oracleText.includes("don't lose") || oracleText.includes("don't lose") ||
          oracleText.includes("doesn't empty") || oracleText.includes("doesn't empty")))) {
      hasRedRetention = true;
    }
    
    // Kruphix, God of Horizons / Horizon Stone - Unspent mana becomes colorless
    if (cardName.includes('kruphix') || cardName.includes('horizon stone') ||
        oracleText.includes('mana becomes colorless instead')) {
      hasColorlessConversion = true;
    }
    
    // Upwelling - All mana doesn't empty
    // Handle different apostrophe styles (straight ' vs curly ')
    if (cardName.includes('upwelling') ||
        (oracleText.includes('mana pools') && 
         (oracleText.includes("don't empty") || oracleText.includes("don't empty")))) {
      hasAllRetention = true;
    }
  }
  
  // If no retention effects, don't tap lands
  if (!hasGreenRetention && !hasRedRetention && !hasColorlessConversion && !hasAllRetention) {
    return { shouldTap: false, reason: 'No mana retention effects' };
  }
  
  // Check if we have untapped lands that could produce the retained colors
  let hasUntappedRetainableLands = false;
  
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId || perm.tapped) continue;
    
    // Check if this is a land or mana source
    const typeLine = (perm.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('land') && !hasManaAbility(perm.card)) continue;
    
    // Skip creatures with summoning sickness
    if (typeLine.includes('creature') && hasCreatureSummoningSickness(perm)) continue;
    
    // Check what colors this produces
    const producedColors = getManaProduction(perm.card);
    
    // Check if any produced color is retained
    for (const color of producedColors) {
      if (hasAllRetention) {
        hasUntappedRetainableLands = true;
        break;
      }
      if (hasGreenRetention && color === 'G') {
        hasUntappedRetainableLands = true;
        break;
      }
      if (hasRedRetention && color === 'R') {
        hasUntappedRetainableLands = true;
        break;
      }
      if (hasColorlessConversion) {
        // Any color can be converted to colorless
        hasUntappedRetainableLands = true;
        break;
      }
    }
    
    if (hasUntappedRetainableLands) break;
  }
  
  if (!hasUntappedRetainableLands) {
    return { shouldTap: false, reason: 'No untapped lands producing retained colors' };
  }
  
  // We have retention effects and untapped lands - tap them!
  let reason = 'Tapping lands for ';
  const reasons = [];
  if (hasGreenRetention) reasons.push('Omnath/green retention');
  if (hasRedRetention) reasons.push('Leyline Tyrant/red retention');
  if (hasColorlessConversion) reasons.push('Kruphix/colorless conversion');
  if (hasAllRetention) reasons.push('Upwelling/all retention');
  reason += reasons.join(', ');
  
  return { shouldTap: true, reason };
}

/**
 * Execute AI tapping lands for mana (when mana retention effects are present)
 * Strategy: Only tap a portion of lands (keeping ~40% or at least 3 untapped) to maintain
 * flexibility for instant-speed responses while still benefiting from retention effects.
 */
async function executeAITapLandsForMana(
  io: Server,
  gameId: string,
  playerId: PlayerID
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  const battlefield = game.state?.battlefield || [];
  
  // Detect which colors are retained
  let retainedColors = new Set<string>();
  let hasAllRetention = false;
  let hasColorlessConversion = false;
  
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId) continue;
    
    const cardName = (perm.card?.name || '').toLowerCase();
    const oracleText = (perm.card?.oracle_text || '').toLowerCase();
    
    if (cardName.includes('omnath, locus of mana') || 
        (oracleText.includes('green mana') && 
         (oracleText.includes("doesn't empty") || oracleText.includes("doesn't empty") ||
          oracleText.includes("don't lose") || oracleText.includes("don't lose")))) {
      retainedColors.add('G');
    }
    
    if (cardName.includes('leyline tyrant') ||
        (oracleText.includes('red mana') && 
         (oracleText.includes("don't lose") || oracleText.includes("don't lose") ||
          oracleText.includes("doesn't empty") || oracleText.includes("doesn't empty")))) {
      retainedColors.add('R');
    }
    
    if (cardName.includes('kruphix') || cardName.includes('horizon stone') ||
        oracleText.includes('mana becomes colorless instead')) {
      hasColorlessConversion = true;
    }
    
    if (cardName.includes('upwelling') ||
        (oracleText.includes('mana pools') && oracleText.includes("don't empty"))) {
      hasAllRetention = true;
    }
  }
  
  // Collect all tappable lands that produce retained colors
  // Strategy: Only tap a portion of lands to keep flexibility for instants
  const tappableLands: any[] = [];
  
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId || perm.tapped) continue;
    
    const typeLine = (perm.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('land') && !hasManaAbility(perm.card)) continue;
    
    // Skip creatures with summoning sickness
    if (typeLine.includes('creature') && hasCreatureSummoningSickness(perm)) continue;
    
    const producedColors = getManaProduction(perm.card);
    if (producedColors.length === 0) continue;
    
    // Check if this produces a retained color
    let shouldTap = false;
    if (hasAllRetention || hasColorlessConversion) {
      shouldTap = true;
    } else {
      for (const color of producedColors) {
        if (retainedColors.has(color)) {
          shouldTap = true;
          break;
        }
      }
    }
    
    if (shouldTap) {
      tappableLands.push({ perm, producedColors });
    }
  }
  
  // Conservative strategy: Keep lands untapped for instant-speed responses
  // Tap at most 60% of available lands, ensuring we don't tap all resources
  const totalTappable = tappableLands.length;
  const minToKeepUntapped = Math.max(MIN_UNTAPPED_LANDS_FOR_INSTANTS, Math.ceil(totalTappable * UNTAPPED_LAND_RATIO));
  const maxToTap = Math.max(0, totalTappable - minToKeepUntapped);
  const landsToTap = tappableLands.slice(0, maxToTap);
  
  debug(2, `[AI] Mana retention: ${totalTappable} tappable lands, will tap ${landsToTap.length}, keep ${totalTappable - landsToTap.length} untapped for flexibility`);
  
  const manaPool = game.state.manaPool[playerId] || {
    white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
  };
  
  let tappedCount = 0;
  
  for (const { perm, producedColors } of landsToTap) {
    // Tap the land/permanent
    perm.tapped = true;
    tappedCount++;
    
    // Add mana to pool based on what it produces
    // Simplification: Add the first color it produces, or any color if it can produce any
    const colorMap: Record<string, string> = {
      'W': 'white', 'U': 'blue', 'B': 'black', 'R': 'red', 'G': 'green', 'C': 'colorless'
    };
    
    if (producedColors.includes('W') && producedColors.includes('U') && 
        producedColors.includes('B') && producedColors.includes('R') && producedColors.includes('G')) {
      // Can produce any color - choose based on retention
      if (retainedColors.has('G')) {
        manaPool.green++;
      } else if (retainedColors.has('R')) {
        manaPool.red++;
      } else {
        // Use first produced color
        const poolColor = colorMap[producedColors[0]] || 'colorless';
        (manaPool as any)[poolColor]++;
      }
    } else {
      // Add the first color it produces
      const poolColor = colorMap[producedColors[0]] || 'colorless';
      (manaPool as any)[poolColor]++;
    }
  }
  
  if (tappedCount > 0) {
    game.state.manaPool[playerId] = manaPool;
    broadcastGame(io, game, gameId);
    debug(1, `[AI] Tapped ${tappedCount} lands for mana retention`);
  }
}

/**
 * Execute AI playing a land
 */
async function executeAIPlayLand(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  cardId: string
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  debug(1, '[AI] Playing land:', { gameId, playerId, cardId });
  
  try {
    // Find the card in hand to check its properties
    const zones = game.state?.zones?.[playerId];
    let cardToPlay: any = null;
    
    if (zones && Array.isArray(zones.hand)) {
      cardToPlay = (zones.hand as any[]).find((c: any) => c?.id === cardId);
    }
    
    // Determine if this land enters tapped
    let entersTapped = false;
    let paidLife = false;
    
    if (cardToPlay) {
      const cardName = (cardToPlay.name || '').toLowerCase();
      
      // Check if it's a shock land
      if (isShockLand(cardName)) {
        // AI decides whether to pay 2 life
        if (shouldAIPayShockLandLife(game, playerId)) {
          // Pay 2 life to enter untapped (but keep a buffer of at least 4 life)
          const players = game.state?.players || [];
          const player = players.find((p: any) => p.id === playerId) as any;
          if (player && player.life >= 4) {
            player.life -= 2;
            paidLife = true;
            debug(1, '[AI] Paid 2 life for shock land to enter untapped:', cardName);
          } else {
            // Life too low, enters tapped to preserve life buffer
            entersTapped = true;
          }
        } else {
          // Choose not to pay, enters tapped
          entersTapped = true;
          debug(1, '[AI] Shock land enters tapped (chose not to pay):', cardName);
        }
      } else if (landEntersTapped(cardToPlay)) {
        // This land always enters tapped
        entersTapped = true;
        debug(1, '[AI] Land enters tapped:', cardName);
      }
    }
    
    // Use game's playLand method if available
    if (typeof (game as any).playLand === 'function') {
      (game as any).playLand(playerId, cardId);
      
      // If land should enter tapped, find and tap it
      if (entersTapped) {
        const battlefield = game.state?.battlefield || [];
        // Find by unique cardId only - name-based fallback removed to prevent issues
        // with multiple copies of the same card (e.g., basic lands, tokens)
        const newPerm = battlefield.find((p: any) => 
          p.controller === playerId && 
          p.card?.id === cardId
        );
        if (newPerm) {
          newPerm.tapped = true;
        }
      }
    } else {
      // Fallback: manually move card from hand to battlefield
      if (zones && Array.isArray(zones.hand)) {
        const hand = zones.hand as any[];
        const idx = hand.findIndex((c: any) => c?.id === cardId);
        if (idx !== -1) {
          const [card] = hand.splice(idx, 1);
          zones.handCount = hand.length;
          
          // Add to battlefield (tapped if necessary)
          game.state.battlefield = game.state.battlefield || [];
          const permanent = {
            id: `perm_${Date.now()}_${cardId}`,
            controller: playerId,
            owner: playerId,
            card: { ...card, zone: 'battlefield' },
            tapped: entersTapped,
            counters: {},
          };
          game.state.battlefield.push(permanent as any);
          
          // Increment lands played
          game.state.landsPlayedThisTurn = game.state.landsPlayedThisTurn || {};
          (game.state.landsPlayedThisTurn as any)[playerId] = ((game.state.landsPlayedThisTurn as any)[playerId] || 0) + 1;
        }
      }
    }
    
    // Handle bounce land ETB trigger - return a land to hand
    if (cardToPlay && isBounceLand((cardToPlay.name || '').toLowerCase())) {
      await handleBounceLandETB(game, playerId, cardToPlay.name);
    }
    
    // Persist event
    try {
      await appendEvent(gameId, (game as any).seq || 0, 'playLand', { 
        playerId, 
        cardId, 
        isAI: true,
        entersTapped,
        paidLife: paidLife ? 2 : 0,
        isBounceLand: cardToPlay ? isBounceLand((cardToPlay.name || '').toLowerCase()) : false,
      });
    } catch (e) {
      debugWarn(1, '[AI] Failed to persist playLand event:', e);
    }
    
    // Bump sequence
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    
    // Broadcast updated state
    broadcastGame(io, game, gameId);
    
  } catch (error) {
    debugError(1, '[AI] Error playing land:', error);
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
  const zones = game.state?.zones?.[playerId];
  
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
    const producedColors = getManaProduction(card);
    if (producedColors.length === 1 && producedColors[0] === 'C') {
      score -= 5;
    }
    
    // Don't return lands that produce multiple colors (they're valuable)
    if (producedColors.length > 2) {
      score += 20;
    }
    
    return { perm, score };
  });
  
  // Sort by score (lowest first = return first)
  scoredLands.sort((a: any, b: any) => a.score - b.score);
  
  // Return the lowest-scored land to hand
  const landToReturn = scoredLands[0]?.perm;
  if (landToReturn) {
    // Remove from battlefield
    const idx = battlefield.indexOf(landToReturn);
    if (idx !== -1) {
      battlefield.splice(idx, 1);
    }
    
    // Add to hand
    if (zones) {
      zones.hand = zones.hand || [];
      const returnedCard = { ...landToReturn.card, zone: 'hand' };
      (zones.hand as any[]).push(returnedCard);
      zones.handCount = (zones.hand as any[]).length;
    }
    
    debug(1, '[AI] Bounce land returned to hand:', landToReturn.card?.name, hasLandfallSynergy ? '(landfall synergy detected)' : '');
  }
}

/**
 * Execute AI casting a spell
 */
async function executeAICastSpell(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  card: any,
  cost: { colors: Record<string, number>; generic: number; cmc: number }
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  debug(1, '[AI] Casting spell:', { gameId, playerId, cardName: card.name, cost });
  
  try {
    // Get mana sources to tap for payment (lands, artifacts, creatures)
    const payments = getPaymentSources(game, playerId, cost);
    
    // Initialize mana pool if needed
    (game.state as any).manaPool = (game.state as any).manaPool || {};
    (game.state as any).manaPool[playerId] = (game.state as any).manaPool[playerId] || {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };
    
    const colorMap: Record<string, string> = { 
      W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colorless' 
    };
    
    // Tap the mana sources and add mana to pool based on assigned colors
    const battlefield = game.state?.battlefield || [];
    for (const payment of payments) {
      const perm = battlefield.find((p: any) => p?.id === payment.sourceId) as any;
      if (perm && !perm.tapped) {
        perm.tapped = true;
        
        // Check if this source produces 2 mana (Sol Ring, etc.)
        const oracleText = ((perm.card as any)?.oracle_text || '').toLowerCase();
        const producesTwoMana = oracleText.includes('{c}{c}') || oracleText.includes('add {c}{c}');
        
        // Add the specific color this source was assigned to produce
        const colorKey = colorMap[payment.produceColor] || 'colorless';
        (game.state as any).manaPool[playerId][colorKey] += producesTwoMana ? 2 : 1;
      }
    }
    
    // Determine targets for targeted spells
    let targets: TargetRef[] = [];
    const oracleText = card.oracle_text || '';
    const typeLine = (card.type_line || '').toLowerCase();
    const isAura = typeLine.includes('enchantment') && typeLine.includes('aura');
    
    // Handle Auras specially - they use "Enchant X" patterns instead of "target" patterns
    if (isAura) {
      const auraTarget = findAuraTarget(game.state, playerId, card);
      if (auraTarget) {
        targets = [{ kind: 'permanent', id: auraTarget.id }];
        debug(1, '[AI] Selected Aura target:', { 
          cardName: card.name, 
          targetName: auraTarget.card?.name || auraTarget.id
        });
      } else {
        debugWarn(2, '[AI] Cannot cast Aura - no valid targets:', card.name);
        return;
      }
    } else {
      // Non-Aura spells use categorizeSpell for targeting
      const spellSpec = categorizeSpell(card.name, oracleText);
      
      if (spellSpec && spellSpec.minTargets > 0) {
        // This spell requires targets - use evaluateTargeting to find valid options
        const validTargets = evaluateTargeting(game.state as any, playerId, spellSpec);
        
        if (validTargets.length > 0) {
          // AI target selection logic:
          // For removal spells, prefer targeting opponent's permanents
          // Prioritize high-threat targets
          const opponentTargets = validTargets.filter((t: TargetRef) => {
            if (t.kind !== 'permanent') return false;
            const perm = battlefield.find((p: any) => p.id === t.id);
            return perm && perm.controller !== playerId;
          });
          
          // Sort opponent targets by threat level (creatures with higher power first)
          opponentTargets.sort((a: TargetRef, b: TargetRef) => {
            const permA = battlefield.find((p: any) => p.id === a.id);
            const permB = battlefield.find((p: any) => p.id === b.id);
            const powerA = parseInt(String(permA?.basePower ?? permA?.card?.power ?? '0'), 10) || 0;
            const powerB = parseInt(String(permB?.basePower ?? permB?.card?.power ?? '0'), 10) || 0;
            return powerB - powerA; // Higher power first
          });
          
          // Select targets (prefer opponent's, fallback to any valid)
          if (opponentTargets.length > 0) {
            targets = opponentTargets.slice(0, spellSpec.maxTargets);
          } else {
            targets = validTargets.slice(0, spellSpec.maxTargets);
          }
          
          debug(1, '[AI] Selected targets for spell:', { 
            cardName: card.name, 
            targetCount: targets.length,
            targets: targets.map((t: TargetRef) => {
              const perm = battlefield.find((p: any) => p.id === t.id);
              return perm?.card?.name || t.id;
            })
          });
        } else {
          // No valid targets available - cannot cast this spell
          debugWarn(2, '[AI] Cannot cast spell - no valid targets:', card.name);
          return;
        }
      }
    }
    
    // Move card from hand to stack
    const zones = game.state?.zones?.[playerId];
    if (zones && Array.isArray(zones.hand)) {
      const hand = zones.hand as any[];
      const idx = hand.findIndex((c: any) => c?.id === card.id);
      if (idx !== -1) {
        const [removedCard] = hand.splice(idx, 1);
        zones.handCount = hand.length;
        
        // Add to stack with targets
        game.state.stack = game.state.stack || [];
        const stackItem = {
          id: `stack_${Date.now()}_${card.id}`,
          controller: playerId,
          card: { ...removedCard, zone: 'stack' },
          targets: targets,
        };
        game.state.stack.push(stackItem as any);
        
        debug(1, '[AI] Spell added to stack:', card.name, 'with', targets.length, 'target(s)');
      }
    }
    
    // Consume mana from pool to pay for spell (leave any excess)
    const pool = (game.state as any).manaPool[playerId];
    
    // Pay colored costs first
    for (const [color, needed] of Object.entries(cost.colors)) {
      const colorKey = colorMap[color];
      if (colorKey && needed > 0) {
        pool[colorKey] = Math.max(0, (pool[colorKey] || 0) - (needed as number));
      }
    }
    
    // Pay generic cost with remaining mana (prefer colorless first)
    let genericLeft = cost.generic;
    if (genericLeft > 0 && pool.colorless > 0) {
      const use = Math.min(pool.colorless, genericLeft);
      pool.colorless -= use;
      genericLeft -= use;
    }
    // Use colored mana for remaining generic
    for (const colorKey of ['white', 'blue', 'black', 'red', 'green']) {
      if (genericLeft <= 0) break;
      if (pool[colorKey] > 0) {
        const use = Math.min(pool[colorKey], genericLeft);
        pool[colorKey] -= use;
        genericLeft -= use;
      }
    }
    
    // Persist event with targets for proper replay
    try {
      await appendEvent(gameId, (game as any).seq || 0, 'castSpell', { 
        playerId, 
        cardId: card.id, 
        cardName: card.name,
        targets: targets,  // Include targets for replay
        card: card,  // Include full card data for replay
        isAI: true 
      });
    } catch (e) {
      debugWarn(1, '[AI] Failed to persist castSpell event:', e);
    }
    
    // Bump sequence
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    
    // Broadcast updated state to all players
    broadcastGame(io, game, gameId);
    
    // IMPORTANT: After casting a spell, pass priority to opponents
    // This allows human players to respond before the spell resolves
    // The spell will resolve when all players pass priority in succession
    setTimeout(async () => {
      await executePassPriority(io, gameId, playerId);
    }, AI_REACTION_DELAY_MS);
    
  } catch (error) {
    debugError(1, '[AI] Error casting spell:', error);
  }
}

/**
 * Execute AI commander cast from command zone
 * Handles command tax, mana payment, and putting commander on stack
 */
async function executeAICastCommander(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  card: any,
  cost: { colors: Record<string, number>; generic: number; cmc: number }
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  debug(1, '[AI] Casting commander from command zone:', { gameId, playerId, cardName: card.name, cost });
  
  try {
    // Get mana sources to tap for payment
    const payments = getPaymentSources(game, playerId, cost);
    
    // Initialize mana pool if needed
    (game.state as any).manaPool = (game.state as any).manaPool || {};
    (game.state as any).manaPool[playerId] = (game.state as any).manaPool[playerId] || {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };
    
    const colorMap: Record<string, string> = { 
      W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colorless' 
    };
    
    // Tap the mana sources and add mana to pool
    const battlefield = game.state?.battlefield || [];
    for (const payment of payments) {
      const perm = battlefield.find((p: any) => p?.id === payment.sourceId) as any;
      if (perm && !perm.tapped) {
        perm.tapped = true;
        
        // Check if this source produces 2 mana
        const oracleText = ((perm.card as any)?.oracle_text || '').toLowerCase();
        const producesTwoMana = oracleText.includes('{c}{c}') || oracleText.includes('add {c}{c}');
        
        const colorKey = colorMap[payment.produceColor] || 'colorless';
        (game.state as any).manaPool[playerId][colorKey] += producesTwoMana ? 2 : 1;
      }
    }
    
    // Mark commander as being cast (removed from command zone temporarily)
    const commandZone = game.state?.commandZone?.[playerId];
    if (commandZone) {
      // Add to stack - commanders go on the stack just like other spells
      game.state.stack = game.state.stack || [];
      const stackItem = {
        id: `stack_${Date.now()}_${card.id}`,
        controller: playerId,
        card: { ...card, zone: 'stack' },
        targets: [],
        isCommander: true,
        fromCommandZone: true,
      };
      game.state.stack.push(stackItem as any);
      
      debug(1, '[AI] Commander added to stack:', card.name);
    }
    
    // Consume mana from pool to pay for commander
    const pool = (game.state as any).manaPool[playerId];
    
    // Pay colored costs first
    for (const [color, needed] of Object.entries(cost.colors)) {
      const colorKey = colorMap[color];
      if (colorKey && needed > 0) {
        pool[colorKey] = Math.max(0, (pool[colorKey] || 0) - (needed as number));
      }
    }
    
    // Pay generic cost with remaining mana
    let genericLeft = cost.generic;
    if (genericLeft > 0 && pool.colorless > 0) {
      const use = Math.min(pool.colorless, genericLeft);
      pool.colorless -= use;
      genericLeft -= use;
    }
    for (const colorKey of ['white', 'blue', 'black', 'red', 'green']) {
      if (genericLeft <= 0) break;
      if (pool[colorKey] > 0) {
        const use = Math.min(pool[colorKey], genericLeft);
        pool[colorKey] -= use;
        genericLeft -= use;
      }
    }
    
    // Persist event
    try {
      await appendEvent(gameId, (game as any).seq || 0, 'castCommander', { 
        playerId, 
        cardId: card.id, 
        cardName: card.name,
        card: card,
        isAI: true 
      });
    } catch (e) {
      debugWarn(1, '[AI] Failed to persist castCommander event:', e);
    }
    
    // Bump sequence
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    
    // Broadcast updated state
    broadcastGame(io, game, gameId);
    
    // Pass priority after casting
    setTimeout(async () => {
      await executePassPriority(io, gameId, playerId);
    }, AI_REACTION_DELAY_MS);
    
  } catch (error) {
    debugError(1, '[AI] Error casting commander:', error);
  }
}

/**
 * Execute AI activated ability activation
 * Handles tapping permanents and putting abilities on the stack
 */
async function executeAIActivateAbility(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  action: any
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  debug(1, '[AI] Activating ability:', { 
    gameId, 
    playerId, 
    cardName: action.cardName,
    permanentId: action.permanentId 
  });
  
  try {
    // Find the permanent on the battlefield
    const battlefield = game.state?.battlefield || [];
    const permanent = battlefield.find((p: any) => p.id === action.permanentId);
    
    if (!permanent) {
      debugWarn(2, '[AI] Permanent not found for ability activation:', action.permanentId);
      return;
    }
    
    const card = permanent.card;
    const abilityText = (card?.oracle_text || '').toLowerCase();
    
    // Check if this is a tap ability
    const isTapAbility = abilityText.includes('{t}:') || abilityText.includes('{t},');
    
    // Tap the permanent if it's a tap ability
    if (isTapAbility && !permanent.tapped) {
      permanent.tapped = true;
      debug(1, '[AI] Tapped permanent for ability:', card.name);
    }
    
    // Handle specific abilities based on oracle text
    
    // HUMBLE DEFECTOR: Draw two cards, give control to opponent
    if (abilityText.includes('draw two cards') && abilityText.includes('opponent') && abilityText.includes('control')) {
      debug(1, '[AI] Activating Humble Defector ability');
      
      // Draw two cards
      if (typeof (game as any).drawCards === 'function') {
        const drawn = (game as any).drawCards(playerId, 2);
        debug(1, '[AI] Drew', drawn?.length || 0, 'cards from Humble Defector');
      }
      
      // Give control to a random opponent
      const opponents = (game.state?.players || [])
        .filter((p: any) => p.id !== playerId && !p.hasLost)
        .map((p: any) => p.id);
      
      if (opponents.length > 0) {
        const randomOpponent = opponents[Math.floor(Math.random() * opponents.length)];
        permanent.controller = randomOpponent;
        
        // Reset summoning sickness for the new controller
        permanent.summoningSickness = true;
        
        debug(1, '[AI] Gave control of', card.name, 'to', randomOpponent);
        
        // Send chat message
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `AI activated ${card.name}: drew 2 cards and gave control to opponent`,
          ts: Date.now(),
        });
      }
    }
    // GENERIC TAP ABILITY: Check if it's a mana ability first
    else if (isTapAbility) {
      // Check if this is a mana ability (mana abilities don't use the stack - MTG Rule 605)
      // Mana abilities produce mana and don't target
      // Patterns matched:
      //   - {W}, {U}, {B}, {R}, {G}, {C} (specific mana symbols)
      //   - "add one mana", "add two mana", "add X mana"
      //   - "mana of any color", "any color", "mana in any combination"
      //   - Must NOT contain "target" (targeting abilities can't be mana abilities)
      const manaProductionPattern = /add\s+(\{[wubrgc]\}|\{[wubrgc]\}\{[wubrgc]\}|one mana|two mana|three mana|mana of any|any color|[xX] mana|an amount of|mana in any combination)/i;
      const hasTargets = /target/i.test(abilityText);
      const isManaAbility = manaProductionPattern.test(abilityText) && !hasTargets;
      
      if (isManaAbility) {
        // Mana abilities resolve immediately - don't put on stack
        // The mana will be added to the mana pool by the game engine
        // For now, we just log that the AI tapped for mana
        debug(1, '[AI] Tapped for mana ability (resolves immediately, not on stack):', card.name);
        // Mana abilities don't pass priority - they resolve instantly
        // Continue AI turn after instant resolution
        setTimeout(() => {
          handleAIPriority(io, gameId, playerId).catch((err) => {
            debugError(1, '[AI] Error continuing after mana ability:', { gameId, playerId, cardName: card.name, error: err });
          });
        }, AI_REACTION_DELAY_MS);
        return;
      } else {
        // For non-mana tap abilities, put them on the stack
        game.state.stack = game.state.stack || [];
        
        // Check if this is a fetch land ability
        // Patterns: "Search your library for a ... land card, put it onto the battlefield"
        // or "sacrifice this artifact/~, pay 1 life: search your library for a ... card"
        const isFetchLand = /search your library for a/i.test(abilityText) && 
                            /land/i.test(abilityText) && 
                            /(put it onto the battlefield|put it.*onto the battlefield)/i.test(abilityText);
        
        if (isFetchLand) {
          // Detect what types of lands can be fetched
          let searchDescription = 'a basic land card';
          let landFilter: any = { types: ['land'], subtypes: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] };
          
          // Specific fetch land detection
          if (/plains or island/i.test(abilityText)) {
            searchDescription = 'a Plains or Island card';
            landFilter = { types: ['land'], subtypes: ['Plains', 'Island'] };
          } else if (/island or swamp/i.test(abilityText)) {
            searchDescription = 'an Island or Swamp card';
            landFilter = { types: ['land'], subtypes: ['Island', 'Swamp'] };
          } else if (/swamp or mountain/i.test(abilityText)) {
            searchDescription = 'a Swamp or Mountain card';
            landFilter = { types: ['land'], subtypes: ['Swamp', 'Mountain'] };
          } else if (/mountain or forest/i.test(abilityText)) {
            searchDescription = 'a Mountain or Forest card';
            landFilter = { types: ['land'], subtypes: ['Mountain', 'Forest'] };
          } else if (/forest or plains/i.test(abilityText)) {
            searchDescription = 'a Forest or Plains card';
            landFilter = { types: ['land'], subtypes: ['Forest', 'Plains'] };
          } else if (/basic land/i.test(abilityText)) {
            searchDescription = 'a basic land card';
            landFilter = { types: ['land', 'basic'] };
          } else if (/forest or island/i.test(abilityText)) {
            searchDescription = 'a Forest or Island card';
            landFilter = { types: ['land'], subtypes: ['Forest', 'Island'] };
          } else if (/plains or swamp/i.test(abilityText)) {
            searchDescription = 'a Plains or Swamp card';
            landFilter = { types: ['land'], subtypes: ['Plains', 'Swamp'] };
          } else if (/island or mountain/i.test(abilityText)) {
            searchDescription = 'an Island or Mountain card';
            landFilter = { types: ['land'], subtypes: ['Island', 'Mountain'] };
          } else if (/swamp or forest/i.test(abilityText)) {
            searchDescription = 'a Swamp or Forest card';
            landFilter = { types: ['land'], subtypes: ['Swamp', 'Forest'] };
          } else if (/mountain or plains/i.test(abilityText)) {
            searchDescription = 'a Mountain or Plains card';
            landFilter = { types: ['land'], subtypes: ['Mountain', 'Plains'] };
          }
          
          const stackItem = {
            id: `stack_ability_${Date.now()}_${permanent.id}`,
            type: 'ability',
            abilityType: 'fetch-land',
            controller: playerId,
            source: permanent.id,
            sourceName: card.name,
            card: {
              id: permanent.id,
              name: `${card.name} (ability)`,
              type_line: 'Activated Ability',
              oracle_text: card.oracle_text,
              image_uris: card.image_uris,
            },
            targets: [],
            searchParams: {
              searchDescription,
              filter: landFilter,
              maxSelections: 1,
              cardImageUrl: card.image_uris?.small || card.image_uris?.normal,
            },
          };
          
          game.state.stack.push(stackItem as any);
          debug(1, '[AI] Added FETCH LAND ability to stack:', card.name);
        } else {
          // Regular non-mana ability
          const stackItem = {
            id: `stack_ability_${Date.now()}_${permanent.id}`,
            type: 'ability',
            controller: playerId,
            source: permanent.id,
            sourceName: card.name,
            card: {
              id: permanent.id,
              name: `${card.name} (ability)`,
              type_line: 'Activated Ability',
              oracle_text: card.oracle_text,
              image_uris: card.image_uris,
            },
            targets: [],
          };
          
          game.state.stack.push(stackItem as any);
          debug(1, '[AI] Added activated ability to stack:', card.name);
        }
      }
    }
    
    // Persist event
    try {
      await appendEvent(gameId, (game as any).seq || 0, 'activateAbility', {
        playerId,
        permanentId: action.permanentId,
        cardName: action.cardName,
        isAI: true,
      });
    } catch (e) {
      debugWarn(1, '[AI] Failed to persist activateAbility event:', e);
    }
    
    // Bump sequence
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    
    // Broadcast updated state
    broadcastGame(io, game, gameId);
    
    // After activating ability, pass priority to allow responses
    setTimeout(async () => {
      await executePassPriority(io, gameId, playerId);
    }, AI_REACTION_DELAY_MS);
    
  } catch (error) {
    debugError(1, '[AI] Error activating ability:', error);
  }
}

/**
 * Resolve AI's spell from the stack
 * 
 * @deprecated This function is not used. Spell resolution happens through
 * executePassPriority() which calls game.resolveTopOfStack() when all players
 * pass priority in succession. This function is kept for reference but should
 * not be called.
 */
async function resolveAISpell(
  io: Server,
  gameId: string,
  playerId: PlayerID
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  const stack = game.state?.stack || [];
  if (stack.length === 0) return;
  
  // Get top of stack (last item)
  const topItem = stack[stack.length - 1] as any;
  if (!topItem || topItem.controller !== playerId) return;
  
  debug(1, '[AI] Resolving spell:', topItem.card?.name);
  
  try {
    // Remove from stack
    stack.pop();
    
    const card = topItem.card as any;
    if (!card) return;
    
    const typeLine = (card.type_line || '').toLowerCase();
    
    // Determine where to put the resolved card
    if (typeLine.includes('creature') || typeLine.includes('artifact') || 
        typeLine.includes('enchantment') || typeLine.includes('planeswalker')) {
      // Permanents go to battlefield
      game.state.battlefield = game.state.battlefield || [];
      const permanent = {
        id: `perm_${Date.now()}_${card.id}`,
        controller: playerId,
        owner: playerId,
        card: { ...card, zone: 'battlefield' },
        tapped: false,
        counters: {},
        // For creatures, track summoning sickness
        summoningSickness: typeLine.includes('creature'),
      };
      game.state.battlefield.push(permanent as any);
      debug(1, '[AI] Permanent entered battlefield:', card.name);
    } else {
      // Instants and sorceries go to graveyard
      const zones = game.state?.zones?.[playerId];
      if (zones) {
        zones.graveyard = zones.graveyard || [];
        (zones.graveyard as any[]).push({ ...card, zone: 'graveyard' });
        zones.graveyardCount = (zones.graveyard as any[]).length;
      }
      debug(1, '[AI] Spell resolved to graveyard:', card.name);
    }
    
    // Bump sequence
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    
    // Broadcast updated state
    broadcastGame(io, game, gameId);
    
  } catch (error) {
    debugError(1, '[AI] Error resolving spell:', error);
  }
}

/**
 * Execute AI discarding cards
 */
async function executeAIDiscard(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  discardCount: number
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  debug(1, '[AI] Discarding', discardCount, 'cards');
  
  try {
    const cardsToDiscard = chooseCardsToDiscard(game, playerId, discardCount);
    
    // Get zones
    const zones = game.state?.zones?.[playerId];
    if (!zones || !Array.isArray(zones.hand)) {
      debugWarn(2, '[AI] No hand found for discard');
      return;
    }
    
    const hand = zones.hand as any[];
    const discardedCards: any[] = [];
    
    for (const cardId of cardsToDiscard) {
      const idx = hand.findIndex((c: any) => c?.id === cardId);
      if (idx !== -1) {
        const [card] = hand.splice(idx, 1);
        discardedCards.push(card);
        
        // Move to graveyard
        zones.graveyard = zones.graveyard || [];
        card.zone = 'graveyard';
        (zones.graveyard as any[]).push(card);
      }
    }
    
    // Update counts
    zones.handCount = hand.length;
    zones.graveyardCount = (zones.graveyard as any[]).length;
    
    // Clear any pending discard state
    if ((game.state as any).pendingDiscardSelection) {
      delete (game.state as any).pendingDiscardSelection[playerId];
    }
    
    // Persist event
    try {
      await appendEvent(gameId, (game as any).seq || 0, 'cleanupDiscard', { 
        playerId, 
        cardIds: cardsToDiscard,
        discardCount: discardedCards.length,
        isAI: true,
      });
    } catch (e) {
      debugWarn(1, '[AI] Failed to persist discard event:', e);
    }
    
    // Bump sequence
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    
    // Broadcast
    broadcastGame(io, game, gameId);
    
    // After discarding, advance to next turn
    setTimeout(() => {
      executeAdvanceStep(io, gameId, playerId).catch(err => debugError(1, err));
    }, AI_REACTION_DELAY_MS);
    
  } catch (error) {
    debugError(1, '[AI] Error discarding:', error);
  }
}

/**
 * Execute advancing to the next step (AI's turn only)
 */
async function executeAdvanceStep(
  io: Server,
  gameId: string,
  playerId: PlayerID
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  // CRITICAL: Only the turn player can advance steps (fail fast)
  // Non-turn players should pass priority instead
  const turnPlayer = game.state?.turnPlayer;
  if (playerId !== turnPlayer) {
    debugWarn(1, '[AI] Cannot advance step - not the turn player:', { 
      gameId, 
      playerId, 
      turnPlayer,
      message: 'Only the active player can advance game steps'
    });
    // Non-turn player should pass priority instead
    await executePassPriority(io, gameId, playerId);
    return;
  }
  
  const currentStep = String((game.state as any).step || '');
  const currentPhase = String(game.state.phase || '');
  
  // Check if there are any pending modal interactions before advancing
  const pendingCheck = checkPendingModals(game, gameId);
  if (pendingCheck.hasPending) {
    debug(1, `[AI] Cannot advance step - ${pendingCheck.reason}`);
    return;
  }
  
  debug(1, '[AI] Advancing step:', { gameId, playerId, currentPhase, currentStep });
  
  try {
    // Use game's nextStep method if available
    if (typeof (game as any).nextStep === 'function') {
      (game as any).nextStep();
    } else {
      debugWarn(2, '[AI] game.nextStep not available');
      return;
    }
    
    const newStep = String((game.state as any).step || '');
    const newPhase = String(game.state.phase || '');
    
    debug(1, '[AI] Step advanced:', { newPhase, newStep });
    
    // Clear cleanup processing flag when advancing from cleanup step
    // This ensures the flag doesn't persist if we re-enter cleanup later
    if (currentStep.toLowerCase().includes('cleanup') && newStep.toLowerCase() !== currentStep.toLowerCase()) {
      if ((game.state as any)._aiProcessingCleanup) {
        debug(1, '[AI] Clearing cleanup processing flags after advancing from cleanup');
        delete (game.state as any)._aiProcessingCleanup;
      }
    }
    
    // Persist event
    try {
      await appendEvent(gameId, (game as any).seq || 0, 'nextStep', { playerId, isAI: true });
    } catch (e) {
      debugWarn(1, '[AI] Failed to persist nextStep event:', e);
    }
    
    // Broadcast
    broadcastGame(io, game, gameId);
    
    // If AI still has priority after advancing AND it's the AI's turn, continue handling
    // CRITICAL: Don't continue if it's CLEANUP step (no priority granted during cleanup per Rule 514.1)
    const newPriority = (game.state as any)?.priority;
    const newTurnPlayer = game.state?.turnPlayer;
    const isStillAITurn = newTurnPlayer === playerId;
    const isCleanupStep = String((game.state as any).step || '').toLowerCase().includes('cleanup');
    
    if (newPriority === playerId && isAIPlayer(gameId, playerId) && isStillAITurn && !isCleanupStep) {
      setTimeout(() => {
        handleAIPriority(io, gameId, playerId).catch(err => debugError(1, err));
      }, AI_THINK_TIME_MS);
    }
    
  } catch (error) {
    debugError(1, '[AI] Error advancing step:', error);
  }
}

/**
 * Execute an AI decision
 */
async function executeAIDecision(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  decision: any
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  switch (decision.type) {
    case AIDecisionType.DECLARE_ATTACKERS:
      if (decision.action?.attackers?.length > 0) {
        await executeDeclareAttackers(io, gameId, playerId, decision.action.attackers);
      } else {
        await executePassPriority(io, gameId, playerId);
      }
      break;
      
    case AIDecisionType.DECLARE_BLOCKERS:
      if (decision.action?.blockers?.length > 0) {
        await executeDeclareBlockers(io, gameId, playerId, decision.action.blockers);
      } else {
        await executePassPriority(io, gameId, playerId);
      }
      break;
      
    case AIDecisionType.PASS_PRIORITY:
    default:
      await executePassPriority(io, gameId, playerId);
      break;
  }
}

/**
 * Execute AI trigger ordering - automatically order triggers on the stack
 * When an AI player has multiple simultaneous triggers, this function
 * puts them on the stack in a sensible order (defaults to the order they were created)
 */
async function executeAITriggerOrdering(
  io: Server,
  gameId: string,
  playerId: PlayerID
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  debug(1, '[AI] Executing trigger ordering:', { gameId, playerId });
  
  try {
    // Get triggers from the trigger queue that belong to this player
    const triggerQueue = (game.state as any).triggerQueue || [];
    const aiTriggers = triggerQueue.filter((t: any) => 
      t.controllerId === playerId && t.type === 'order'
    );
    
    if (aiTriggers.length === 0) {
      debug(1, '[AI] No triggers to order, clearing pending state');
      // Clear the pending trigger ordering state
      if ((game.state as any).pendingTriggerOrdering) {
        delete (game.state as any).pendingTriggerOrdering[playerId];
        if (Object.keys((game.state as any).pendingTriggerOrdering).length === 0) {
          delete (game.state as any).pendingTriggerOrdering;
        }
      }
      broadcastGame(io, game, gameId);
      return;
    }
    
    debug(1, `[AI] Found ${aiTriggers.length} triggers to order`);
    
    // Remove triggers from the queue
    (game.state as any).triggerQueue = triggerQueue.filter((t: any) => 
      !(t.controllerId === playerId && t.type === 'order')
    );
    
    // Put triggers on the stack in the order they were created
    // (First trigger goes on stack first, resolves last - this is the default)
    game.state.stack = game.state.stack || [];
    
    const orderedTriggerIds: string[] = [];
    for (const trigger of aiTriggers) {
      const stackItem = {
        id: `stack_trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'ability',
        controller: playerId,
        card: {
          id: trigger.sourceId,
          name: `${trigger.sourceName} (trigger)`,
          type_line: 'Triggered Ability',
          oracle_text: trigger.effect,
          image_uris: trigger.imageUrl ? { small: trigger.imageUrl, normal: trigger.imageUrl } : undefined,
        },
        targets: trigger.targets || [],
      };
      
      game.state.stack.push(stackItem as any);
      orderedTriggerIds.push(trigger.id);
      debug(1, `[AI] ⚡ Pushed trigger to stack: ${trigger.sourceName} - ${trigger.effect}`);
    }
    
    // Clear the pending trigger ordering state - CRITICAL to break the loop
    if ((game.state as any).pendingTriggerOrdering) {
      delete (game.state as any).pendingTriggerOrdering[playerId];
      if (Object.keys((game.state as any).pendingTriggerOrdering).length === 0) {
        delete (game.state as any).pendingTriggerOrdering;
      }
    }
    
    // Also clear the prompt tracking set since triggers have been ordered
    if ((game.state as any)._triggerOrderingPromptedPlayers) {
      delete (game.state as any)._triggerOrderingPromptedPlayers;
    }
    
    // Send chat message about the triggers being put on the stack
    const triggerNames = aiTriggers.map((t: any) => t.sourceName).join(', ');
    try {
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `AI orders ${aiTriggers.length} triggered abilities on the stack: ${triggerNames}`,
        ts: Date.now(),
      });
    } catch (e) {
      // Non-critical
    }
    
    // Persist the event
    try {
      await appendEvent(gameId, (game as any).seq || 0, 'orderTriggers', {
        playerId,
        orderedTriggerIds,
        isAI: true,
      });
    } catch (e) {
      debugWarn(1, '[AI] Failed to persist orderTriggers event:', e);
    }
    
    // Bump sequence and broadcast
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    
    broadcastGame(io, game, gameId);
    
    debug(1, `[AI] Successfully ordered ${aiTriggers.length} triggers onto stack`);
    
  } catch (error) {
    debugError(1, '[AI] Error ordering triggers:', error);
    // On error, still try to clear the pending state to prevent infinite loop
    if ((game.state as any).pendingTriggerOrdering) {
      delete (game.state as any).pendingTriggerOrdering[playerId];
      if (Object.keys((game.state as any).pendingTriggerOrdering).length === 0) {
        delete (game.state as any).pendingTriggerOrdering;
      }
    }
    broadcastGame(io, game, gameId);
  }
}

/**
 * Execute AI decision for Kynaios and Tiro of Meletis style choice
 * AI will play a land if it has one, otherwise decline (controller) or draw (opponent)
 */
async function executeAIKynaiosChoice(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  sourceController: string,
  choiceData: any
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  debug(1, '[AI] Executing Kynaios choice:', { gameId, playerId, sourceController });
  
  try {
    // Initialize tracking arrays if needed
    choiceData.playersWhoPlayedLand = choiceData.playersWhoPlayedLand || [];
    choiceData.playersWhoDeclined = choiceData.playersWhoDeclined || [];
    
    const isController = playerId === sourceController;
    
    // Check if AI has lands in hand
    const zones = (game.state as any).zones?.[playerId];
    const hand = zones?.hand || [];
    const landsInHand = hand.filter((card: any) => 
      card && (card.type_line || '').toLowerCase().includes('land')
    );
    
    if (landsInHand.length > 0) {
      // AI has lands - play the first one
      const landCard = landsInHand[0];
      const cardIndex = hand.findIndex((c: any) => c?.id === landCard.id);
      const cardName = landCard.name || "Land";
      
      // Remove from hand
      hand.splice(cardIndex, 1);
      zones.handCount = hand.length;
      
      // Put onto battlefield
      game.state.battlefield = game.state.battlefield || [];
      const permanentId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      
      // Check if land enters tapped
      const oracleText = (landCard.oracle_text || '').toLowerCase();
      const entersTapped = oracleText.includes('enters tapped') || 
                          oracleText.includes('enters the battlefield tapped');
      
      const permanent = {
        id: permanentId,
        card: landCard,
        owner: playerId,
        controller: playerId,
        tapped: entersTapped,
        summoningSickness: false,
        zone: 'battlefield',
      };
      
      game.state.battlefield.push(permanent as any);
      
      // Track that AI played a land
      choiceData.playersWhoPlayedLand.push(playerId);
      
      // Chat message
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `AI ${playerId} puts ${cardName} onto the battlefield (${choiceData.sourceName || 'Kynaios and Tiro'}).`,
        ts: Date.now(),
      });
      
      debug(1, `[AI] AI ${playerId} played land ${cardName} via Kynaios choice`);
      
    } else {
      // No lands - decline (controller will just skip, opponent will draw later)
      choiceData.playersWhoDeclined.push(playerId);
      
      const action = isController ? "declines to play a land" : "chooses to draw a card";
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `AI ${playerId} ${action} (${choiceData.sourceName || 'Kynaios and Tiro'}).`,
        ts: Date.now(),
      });
      
      debug(1, `[AI] AI ${playerId} ${action} via Kynaios choice`);
    }
    
    // Persist event
    try {
      await appendEvent(gameId, (game as any).seq || 0, 'kynaiosChoice', {
        playerId,
        sourceController,
        choice: landsInHand.length > 0 ? 'play_land' : (isController ? 'decline' : 'draw_card'),
        landCardId: landsInHand.length > 0 ? landsInHand[0].id : undefined,
        isAI: true,
      });
    } catch (e) {
      debugWarn(1, '[AI] Failed to persist kynaiosChoice event:', e);
    }
    
    // Bump sequence and broadcast
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    
    broadcastGame(io, game, gameId);
    
    debug(1, `[AI] Successfully made Kynaios choice`);
    
  } catch (error) {
    debugError(1, '[AI] Error making Kynaios choice:', error);
    // On error, mark as declined to prevent infinite loop
    choiceData.playersWhoDeclined = choiceData.playersWhoDeclined || [];
    if (!choiceData.playersWhoDeclined.includes(playerId)) {
      choiceData.playersWhoDeclined.push(playerId);
    }
    broadcastGame(io, game, gameId);
  }
}

/**
 * Execute pass priority for AI
 */
async function executePassPriority(
  io: Server,
  gameId: string,
  playerId: PlayerID
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  debug(1, '[AI] Passing priority:', { gameId, playerId });
  
  try {
    let resolvedNow = false;
    let advanceStep = false;
    
    // Use game's pass priority method if available
    // Mark as auto-pass so that autoPassLoop runs and checks if other players can also auto-pass
    if (typeof (game as any).passPriority === 'function') {
      const result = (game as any).passPriority(playerId, true); // true = isAutoPass
      resolvedNow = result?.resolvedNow ?? false;
      advanceStep = result?.advanceStep ?? false;
    } else {
      // Fallback: advance priority manually
      const state = game.state;
      if (state && Array.isArray(state.players)) {
        const order = state.players.map((p: any) => p.id);
        const idx = order.indexOf(playerId);
        if (idx >= 0) {
          const nextPriority = order[(idx + 1) % order.length];
          (state as any).priority = nextPriority;
        }
      }
    }
    
    // Persist event
    try {
      await appendEvent(gameId, (game as any).seq || 0, 'passPriority', { playerId });
    } catch (e) {
      debugWarn(1, '[AI] Failed to persist passPriority event:', e);
    }
    
    // If all players passed priority in succession, resolve the top of the stack
    if (resolvedNow) {
      debug(1, '[AI] All players passed priority, resolving top of stack');
      if (typeof (game as any).resolveTopOfStack === 'function') {
        (game as any).resolveTopOfStack();
        debug(2, `[AI] Stack resolved for game ${gameId}`);
      }
      
      // Check for pending control change activations (Vislor Turlough, Xantcha, etc.)
      // For AI players, we auto-select an opponent to give control to
      await handlePendingControlChangesAfterResolution(io, game, gameId);
      
      // Persist the resolution event
      try {
        await appendEvent(gameId, (game as any).seq || 0, 'resolveTopOfStack', { playerId });
      } catch (e) {
        debugWarn(1, '[AI] Failed to persist resolveTopOfStack event:', e);
      }
    }
    
    // If all players passed priority with empty stack, advance to next step
    // BUT: Do NOT advance if there are pending modals (e.g., library searches, color choices, creature type selections, Join Forces)
    // Human players need time to complete their modal interactions
    if (advanceStep) {
      const pendingCheck = checkPendingModals(game, gameId);
      if (pendingCheck.hasPending) {
        debug(1, `[AI] Cannot advance step - ${pendingCheck.reason}`);
      } else {
        debug(1, '[AI] All players passed priority with empty stack, advancing step');
        if (typeof (game as any).nextStep === 'function') {
          (game as any).nextStep();
          debug(2, `[AI] Advanced to next step for game ${gameId}`);
          
          // Check if the new step triggered auto-pass that wants to advance again
          let autoPassLoopCount = 0;
          const MAX_AUTO_PASS_LOOPS = 20;
          
          while (autoPassLoopCount < MAX_AUTO_PASS_LOOPS) {
            const autoPassResult = (game.state as any)?._autoPassResult;
            
            // CRITICAL: Check if current priority player is human
            // If a human player has priority, STOP advancing - they need time to act
            const currentPriority = (game.state as any)?.priority;
            if (currentPriority) {
              const priorityPlayer = (game.state as any)?.players?.find((p: any) => p?.id === currentPriority);
              if (priorityPlayer && !priorityPlayer.isAI) {
                debug(2, `[AI] Auto-pass loop stopping - human player ${currentPriority} has priority`);
                break;
              }
            }
            
            if (autoPassResult?.allPassed && autoPassResult?.advanceStep) {
              debug(2, `[AI] Auto-pass detected after step advancement (iteration ${autoPassLoopCount + 1}), advancing again`);
              
              delete (game.state as any)._autoPassResult;
              (game as any).nextStep();
              
              const newStep = (game.state as any)?.step || 'unknown';
              debug(2, `[AI] Auto-advanced to ${newStep}`);
              
              autoPassLoopCount++;
            } else {
              break;
            }
          }
          
          if (autoPassLoopCount >= MAX_AUTO_PASS_LOOPS) {
            debugWarn(2, `[AI] Auto-pass loop limit reached, stopping`);
          }
          
          delete (game.state as any)._autoPassResult;
        }
        
        // Persist the step advance event
        try {
          await appendEvent(gameId, (game as any).seq || 0, 'nextStep', { playerId, reason: 'allPlayersPassed' });
        } catch (e) {
          debugWarn(1, '[AI] Failed to persist nextStep event:', e);
        }
      }
    }
    
    // Broadcast updated state
    broadcastGame(io, game, gameId);
    
    // Check if next player is also AI
    const nextPriority = (game.state as any)?.priority;
    if (nextPriority && isAIPlayer(gameId, nextPriority)) {
      // Small delay before AI acts
      setTimeout(() => {
        handleAIPriority(io, gameId, nextPriority).catch(err => debugError(1, err));
      }, AI_REACTION_DELAY_MS);
    }
    
  } catch (error) {
    debugError(1, '[AI] Error passing priority:', error);
  }
}

/**
 * Execute declare attackers for AI
 */
async function executeDeclareAttackers(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  attackers: Array<{ creatureId: string; defendingPlayerId: string }>
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  debug(1, '[AI] Declaring attackers:', { gameId, playerId, attackers });
  
  try {
    // Extract creature IDs for game.declareAttackers
    const attackerIds = attackers.map(a => a.creatureId);
    
    // Mark creatures as attacking and tap them
    const battlefield = game.state?.battlefield || [];
    for (const attacker of attackers) {
      const creature = battlefield.find((perm: any) => 
        perm.id === attacker.creatureId && perm.controller === playerId
      );
      
      if (creature) {
        // Mark as attacking the defending player
        (creature as any).attacking = attacker.defendingPlayerId;
        
        // Tap the attacker (unless it has vigilance)
        const hasVigilance = (creature as any).card?.keywords?.some((k: string) => 
          k.toLowerCase().includes('vigilance')
        ) || (creature as any).grantedAbilities?.some((k: string) => 
          k.toLowerCase().includes('vigilance')
        );
        
        if (!hasVigilance) {
          (creature as any).tapped = true;
        }
      }
    }
    
    if (typeof (game as any).declareAttackers === 'function') {
      (game as any).declareAttackers(playerId, attackerIds);
    }
    
    await appendEvent(gameId, (game as any).seq || 0, 'declareAttackers', { playerId, attackers });
    broadcastGame(io, game, gameId);
    
    // After declaring attackers, pass priority to allow opponents to respond
    // (cast instants, activate abilities before moving to declare blockers)
    // The step will advance when all players pass priority in succession
    await executePassPriority(io, gameId, playerId);
    
  } catch (error) {
    debugError(1, '[AI] Error declaring attackers:', error);
    await executePassPriority(io, gameId, playerId);
  }
}

/**
 * Execute declare blockers for AI
 */
async function executeDeclareBlockers(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  blockers: Array<{ blockerId: string; attackerId: string }>
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  debug(1, '[AI] Declaring blockers:', { gameId, playerId, blockers });
  
  try {
    if (typeof (game as any).declareBlockers === 'function') {
      (game as any).declareBlockers(playerId, blockers);
    }
    
    await appendEvent(gameId, (game as any).seq || 0, 'declareBlockers', { playerId, blockers });
    broadcastGame(io, game, gameId);
    
    // After declaring blockers, pass priority to allow responses
    // (cast instants, activate abilities before combat damage)
    // The step will advance when all players pass priority in succession
    await executePassPriority(io, gameId, playerId);
    
  } catch (error) {
    debugError(1, '[AI] Error declaring blockers:', error);
    await executePassPriority(io, gameId, playerId);
  }
}

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

/**
 * Register socket handlers for AI management
 */
export function registerAIHandlers(io: Server, socket: Socket): void {
  // Create game without AI (human players only)
  socket.on('createGame', async ({
    gameId,
    format,
    startingLife,
  }: {
    gameId: string;
    format?: string;
    startingLife?: number;
  }) => {
    try {
      debug(1, '[Game] Creating game without AI:', { gameId, format, startingLife });
      
      // Create a NEW game using GameManager.createGame() which handles DB persistence
      let game = GameManager.getGame(gameId);
      if (!game) {
        try {
          game = GameManager.createGame({ id: gameId });
          debug(1, '[Game] Created new game via GameManager:', gameId);
        } catch (createErr: any) {
          // Game might already exist (race condition), try to get it again
          game = GameManager.getGame(gameId);
          if (!game) {
            debugError(1, '[Game] Failed to create or get game:', createErr);
            socket.emit('error', { code: 'GAME_CREATE_FAILED', message: 'Failed to create game' });
            return;
          }
          debug(1, '[Game] Game was created by another request, reusing:', gameId);
        }
      }
      
      // Set format and starting life
      game.state = (game.state || {}) as any;
      (game.state as any).format = format || 'commander';
      (game.state as any).startingLife = startingLife || (format === 'commander' ? 40 : 20);
      
      debug(1, '[Game] Game created successfully:', { gameId, format: (game.state as any).format, startingLife: (game.state as any).startingLife });
    } catch (err) {
      debugError(1, '[Game] Error creating game:', err);
      socket.emit('error', { 
        code: 'GAME_CREATE_FAILED', 
        message: err instanceof Error ? err.message : 'Failed to create game' 
      });
    }
  });

  // Create game with AI opponent
  socket.on('createGameWithAI', async ({
    gameId,
    playerName,
    format,
    startingLife,
    aiName,
    aiStrategy,
    aiDifficulty,
    aiDeckId,
    aiDeckText,
    aiDeckName,
  }: {
    gameId: string;
    playerName: string;
    format?: string;
    startingLife?: number;
    aiName?: string;
    aiStrategy?: string;
    aiDifficulty?: number;
    aiDeckId?: string;
    aiDeckText?: string;
    aiDeckName?: string;
  }) => {
    try {
      debug(1, '[AI] Creating game with AI:', { gameId, playerName, aiName, aiStrategy, aiDifficulty, hasText: !!aiDeckText });
      
      // Create a NEW game using GameManager.createGame() which handles DB persistence
      // This is critical - ensureGame() checks if the game exists in DB first,
      // which fails for NEW games. We must use createGame() for new games.
      let game = GameManager.getGame(gameId);
      if (!game) {
        try {
          game = GameManager.createGame({ id: gameId });
          debug(1, '[AI] Created new game via GameManager:', gameId);
        } catch (createErr: any) {
          // Game might already exist (race condition), try to get it again
          game = GameManager.getGame(gameId);
          if (!game) {
            debugError(1, '[AI] Failed to create or get game:', createErr);
            socket.emit('error', { code: 'GAME_CREATE_FAILED', message: 'Failed to create game' });
            return;
          }
          debug(1, '[AI] Game was created by another request, reusing:', gameId);
        }
      }
      
      // Set format and starting life
      game.state = (game.state || {}) as any;
      (game.state as any).format = format || 'commander';
      (game.state as any).startingLife = startingLife || (format === 'commander' ? 40 : 20);
      
      // Join the AI player to the game first
      // This will generate a playerId and properly initialize the player
      const strategy = (aiStrategy as AIStrategy) || AIStrategy.BASIC;
      const difficulty = aiDifficulty ?? 0.5; // Default to medium difficulty
      const aiPlayerName = aiName || 'AI Opponent';
      let joinResult: any;
      let aiPlayerId: string;
      
      if (typeof (game as any).join === 'function') {
        try {
          // Use a fake socket ID for the AI player
          const aiSocketId = `ai_socket_${Date.now().toString(36)}`;
          joinResult = (game as any).join(aiSocketId, aiPlayerName, false);
          aiPlayerId = joinResult?.playerId || `ai_${Date.now().toString(36)}`;
          debug(1, '[AI] AI player joined game via game.join():', { aiPlayerId, aiPlayerName });
        } catch (err) {
          debugWarn(1, '[AI] game.join failed for AI, using fallback:', err);
          aiPlayerId = `ai_${Date.now().toString(36)}`;
        }
      } else {
        // Fallback if game.join is not available
        aiPlayerId = `ai_${Date.now().toString(36)}`;
      }
      
      // Mark the player as AI in the game state and save strategy/difficulty for replay
      game.state.players = game.state.players || [];
      const playerInState = game.state.players.find((p: any) => p.id === aiPlayerId);
      if (playerInState) {
        playerInState.isAI = true;
        playerInState.strategy = strategy;
        playerInState.difficulty = difficulty;
      }
      
      // Load deck for AI - either from saved deck ID or from imported text
      let deckLoaded = false;
      let deckLoadError: string | undefined;
      let deckEntries: Array<{ name: string; count: number }> = [];
      let finalDeckName: string | undefined;
      
      // Priority 1: Use aiDeckText if provided (import mode)
      if (aiDeckText && aiDeckText.trim()) {
        try {
          deckEntries = parseDecklist(aiDeckText);
          finalDeckName = aiDeckName || 'Imported Deck';
          debug(1, '[AI] Using imported deck text:', { deckName: finalDeckName, entryCount: deckEntries.length });
        } catch (e) {
          debugWarn(1, '[AI] Failed to parse deck text:', e);
          deckLoadError = 'Failed to parse deck text';
        }
      }
      // Priority 2: Use aiDeckId if provided (select mode)
      else if (aiDeckId) {
        try {
          const deck = getDeck(aiDeckId);
          if (deck && deck.entries && deck.entries.length > 0) {
            deckEntries = deck.entries;
            finalDeckName = deck.name;
            debug(1, '[AI] Loading deck for AI:', { deckId: aiDeckId, deckName: deck.name, cardCount: deck.card_count });
          } else {
            deckLoadError = `Deck with ID "${aiDeckId}" not found or is empty`;
            debugWarn(1, '[AI] Deck not found:', { deckId: aiDeckId, error: deckLoadError });
          }
        } catch (e) {
          deckLoadError = `Failed to load deck "${aiDeckId}": ${e instanceof Error ? e.message : String(e)}`;
          debugError(1, '[AI] Error loading deck for AI:', { deckId: aiDeckId, error: e });
        }
      }
      
      // Resolve deck entries if we have any
      if (deckEntries.length > 0) {
        const requestedNames = deckEntries.map((e: any) => e.name);
        let byName: Map<string, any> | null = null;
        
        try {
          byName = await fetchCardsByExactNamesBatch(requestedNames);
        } catch (e) {
          debugWarn(1, '[AI] Failed to fetch cards from Scryfall:', e);
        }
        
        const resolvedCards: any[] = [];
        const missing: string[] = [];
        
        if (byName) {
          for (const { name, count } of deckEntries) {
            const key = normalizeName(name).toLowerCase();
            const card = byName.get(key);
            if (!card) {
              missing.push(name);
              continue;
            }
            for (let i = 0; i < (count || 1); i++) {
              resolvedCards.push({
                id: generateId(`card_${card.id}`),
                name: card.name,
                type_line: card.type_line,
                oracle_text: card.oracle_text,
                image_uris: card.image_uris,
                mana_cost: card.mana_cost,
                power: card.power,
                toughness: card.toughness,
                color_identity: card.color_identity, // Include color_identity from Scryfall
                zone: 'library',
              });
            }
          }
        }
        
        if (resolvedCards.length > 0) {
          // IMPORTANT: Don't shuffle yet - we need the original order for commander detection
          // The commander(s) are typically first in the decklist.
          // Use importDeckResolved to properly populate the context's libraries Map
          // This ensures shuffle/draw operations work correctly later.
          
          deckLoaded = true;
          
          // Use the game's importDeckResolved function to properly populate the libraries Map
          // This is critical for shuffle/draw operations to work correctly
          if (typeof (game as any).importDeckResolved === 'function') {
            (game as any).importDeckResolved(aiPlayerId, resolvedCards);
            debug(1, '[AI] Deck imported via importDeckResolved for AI:', { 
              aiPlayerId, 
              deckName: finalDeckName, 
              resolvedCount: resolvedCards.length,
            });
            
            // CRITICAL: Persist the deck import to event log for replay after server restart / undo
            try {
              await appendEvent(gameId, (game as any).seq || 0, 'deckImportResolved', {
                playerId: aiPlayerId,
                cards: resolvedCards,
              });
              debug(1, '[AI] Persisted deckImportResolved event for AI:', { aiPlayerId, cardCount: resolvedCards.length });
            } catch (e) {
              debugWarn(1, '[AI] Failed to persist deckImportResolved event:', e);
            }
          } else {
            // Fallback: manually initialize zones (this may cause issues with shuffle/draw)
            debugWarn(2, '[AI] importDeckResolved not available, using fallback zone initialization');
            game.state.zones = game.state.zones || {};
            (game.state.zones as any)[aiPlayerId] = {
              hand: [],
              handCount: 0,
              libraryCount: resolvedCards.length,
              graveyard: [],
              graveyardCount: 0,
            };
            // Note: We don't set library in zones - the authoritative source is ctx.libraries
          }
          
          // Store deck metadata on the player object
          const playerInState = game.state.players?.find((p: any) => p.id === aiPlayerId);
          if (playerInState) {
            playerInState.deckName = finalDeckName;
            playerInState.deckId = aiDeckId || (aiDeckText ? `imported_${Date.now().toString(36)}` : null);
          }
          
          debug(1, '[AI] Deck resolved for AI:', { 
            aiPlayerId, 
            deckName: finalDeckName, 
            resolvedCount: resolvedCards.length,
            missingCount: missing.length,
          });
          
          if (missing.length > 0) {
            debugWarn(2, '[AI] Missing cards in AI deck:', missing.slice(0, 10));
          }
        } else {
          deckLoadError = `No cards could be resolved from deck "${finalDeckName}"`;
          debugWarn(1, '[AI] No cards resolved:', { error: deckLoadError });
        }
      }
      
      // Register with AI engine
      registerAIPlayer(gameId, aiPlayerId, aiPlayerName, strategy, difficulty);
      
      // Persist AI join event as a regular 'join' event so it can be properly replayed after server restart
      // Include isAI flag and seatToken from the join result
      try {
        const seatToken = joinResult?.seatToken || `ai_token_${randomBytes(6).toString('hex')}`;
        await appendEvent(gameId, (game as any).seq || 0, 'join', {
          playerId: aiPlayerId,
          name: aiPlayerName,
          seatToken,
          spectator: false,
          isAI: true,
          strategy,
          deckId: aiDeckId,
          deckLoaded,
        });
      } catch (e) {
        debugWarn(1, '[AI] Failed to persist AI join event:', e);
      }
      
      // Emit success
      socket.emit('aiPlayerCreated', {
        gameId,
        aiPlayerId,
        aiName: aiName || 'AI Opponent',
        strategy,
        deckLoaded,
        deckName: deckLoaded ? (game.state.players.find((p: any) => p.id === aiPlayerId) as any)?.deckName : undefined,
      });
      
      // Broadcast game state
      broadcastGame(io, game, gameId);
      
      // If deck was loaded, trigger auto-commander selection
      if (deckLoaded) {
        debug(1, '[AI] Triggering auto-commander selection for AI:', { gameId, aiPlayerId });
        
        // Small delay to ensure state is propagated
        setTimeout(async () => {
          try {
            await handleAIGameFlow(io, gameId, aiPlayerId);
          } catch (e) {
            debugError(1, '[AI] Error in AI game flow after deck load:', e);
          }
        }, AI_THINK_TIME_MS);
      }
      
    } catch (error) {
      debugError(1, '[AI] Error creating game with AI:', error);
      socket.emit('error', { code: 'AI_CREATE_FAILED', message: 'Failed to create AI opponent' });
    }
  });

  // Create game with multiple AI opponents
  socket.on('createGameWithMultipleAI', async ({
    gameId,
    playerName,
    format,
    startingLife,
    aiOpponents,
  }: {
    gameId: string;
    playerName: string;
    format?: string;
    startingLife?: number;
    aiOpponents: Array<{
      name: string;
      strategy: string;
      difficulty?: number;
      deckId?: string;
      deckText?: string;
      deckName?: string;
    }>;
  }) => {
    try {
      debug(1, '[AI] Creating game with multiple AI opponents:', { 
        gameId, 
        playerName, 
        aiCount: aiOpponents.length,
        aiNames: aiOpponents.map(ai => ai.name),
        aiDifficulties: aiOpponents.map(ai => ai.difficulty ?? 0.5),
      });
      
      // Create a NEW game using GameManager.createGame() which handles DB persistence
      // This is critical - ensureGame() checks if the game exists in DB first,
      // which fails for NEW games. We must use createGame() for new games.
      let game = GameManager.getGame(gameId);
      if (!game) {
        try {
          game = GameManager.createGame({ id: gameId });
          debug(1, '[AI] Created new game via GameManager:', gameId);
        } catch (createErr: any) {
          // Game might already exist (race condition), try to get it again
          game = GameManager.getGame(gameId);
          if (!game) {
            debugError(1, '[AI] Failed to create or get game:', createErr);
            socket.emit('error', { code: 'GAME_CREATE_FAILED', message: 'Failed to create game' });
            return;
          }
          debug(1, '[AI] Game was created by another request, reusing:', gameId);
        }
      }
      
      // Set format and starting life
      game.state = (game.state || {}) as any;
      (game.state as any).format = format || 'commander';
      (game.state as any).startingLife = startingLife || (format === 'commander' ? 40 : 20);
      game.state.players = game.state.players || [];
      
      const createdAIPlayers: Array<{ playerId: string; name: string; strategy: string; deckLoaded: boolean }> = [];
      
      // Create each AI opponent
      for (let i = 0; i < aiOpponents.length; i++) {
        const aiConfig = aiOpponents[i];
        const strategy = (aiConfig.strategy as AIStrategy) || AIStrategy.BASIC;
        const difficulty = aiConfig.difficulty ?? 0.5; // Default to medium difficulty
        const aiName = aiConfig.name || `AI Opponent ${i + 1}`;
        
        // Join the AI player to the game first
        // This will generate a playerId and properly initialize the player
        let joinResult: any;
        let aiPlayerId: string;
        
        if (typeof (game as any).join === 'function') {
          try {
            // Use a fake socket ID for the AI player
            const aiSocketId = `ai_socket_${Date.now().toString(36)}_${i}`;
            joinResult = (game as any).join(aiSocketId, aiName, false);
            aiPlayerId = joinResult?.playerId || `ai_${Date.now().toString(36)}_${i}`;
            debug(1, `[AI] AI player joined game via game.join():`, { aiPlayerId, aiName });
          } catch (err) {
            debugWarn(1, `[AI] game.join failed for ${aiName}, using fallback:`, err);
            aiPlayerId = `ai_${Date.now().toString(36)}_${i}`;
          }
        } else {
          // Fallback if game.join is not available
          aiPlayerId = `ai_${Date.now().toString(36)}_${i}`;
        }
        
        // Mark the player as AI in the game state and save strategy/difficulty for replay
        const playerInState = game.state.players?.find((p: any) => p.id === aiPlayerId);
        if (playerInState) {
          playerInState.isAI = true;
          playerInState.strategy = strategy;
          playerInState.difficulty = difficulty;
        }
        
        // Load deck for AI
        let deckLoaded = false;
        let deckEntries: Array<{ name: string; count: number }> = [];
        let finalDeckName: string | undefined;
        
        // Priority 1: Use deckText if provided (import mode)
        if (aiConfig.deckText && aiConfig.deckText.trim()) {
          try {
            deckEntries = parseDecklist(aiConfig.deckText);
            finalDeckName = aiConfig.deckName || 'Imported Deck';
            debug(1, `[AI] Using imported deck text for ${aiName}:`, { deckName: finalDeckName, entryCount: deckEntries.length });
          } catch (e) {
            debugWarn(1, `[AI] Failed to parse deck text for ${aiName}:`, e);
          }
        }
        // Priority 2: Use deckId if provided (select mode)
        else if (aiConfig.deckId) {
          try {
            const deck = getDeck(aiConfig.deckId);
            if (deck && deck.entries && deck.entries.length > 0) {
              deckEntries = deck.entries;
              finalDeckName = deck.name;
              debug(1, `[AI] Loading deck for ${aiName}:`, { deckId: aiConfig.deckId, deckName: deck.name });
            } else {
              debugWarn(2, `[AI] Deck not found for ${aiName}:`, { deckId: aiConfig.deckId });
            }
          } catch (e) {
            debugError(1, `[AI] Error loading deck for ${aiName}:`, { deckId: aiConfig.deckId, error: e });
          }
        }
        
        // Resolve deck entries if we have any
        if (deckEntries.length > 0) {
          const requestedNames = deckEntries.map((e: any) => e.name);
          let byName: Map<string, any> | null = null;
          
          try {
            byName = await fetchCardsByExactNamesBatch(requestedNames);
          } catch (e) {
            debugWarn(1, `[AI] Failed to fetch cards from Scryfall for ${aiName}:`, e);
          }
          
          const resolvedCards: any[] = [];
          
          if (byName) {
            for (const { name, count } of deckEntries) {
              const key = normalizeName(name).toLowerCase();
              const card = byName.get(key);
              if (!card) continue;
              for (let j = 0; j < (count || 1); j++) {
                resolvedCards.push({
                  id: generateId(`card_${card.id}`),
                  name: card.name,
                  type_line: card.type_line,
                  oracle_text: card.oracle_text,
                  image_uris: card.image_uris,
                  mana_cost: card.mana_cost,
                  power: card.power,
                  toughness: card.toughness,
                  color_identity: card.color_identity,
                  zone: 'library',
                });
              }
            }
          }
          
          if (resolvedCards.length > 0) {
            deckLoaded = true;
            
            if (typeof (game as any).importDeckResolved === 'function') {
              (game as any).importDeckResolved(aiPlayerId, resolvedCards);
              debug(1, `[AI] Deck imported for ${aiName}:`, { 
                aiPlayerId, 
                deckName: finalDeckName, 
                resolvedCount: resolvedCards.length,
              });
              
              // CRITICAL: Persist the deck import to event log for replay after server restart / undo
              try {
                await appendEvent(gameId, (game as any).seq || 0, 'deckImportResolved', {
                  playerId: aiPlayerId,
                  cards: resolvedCards,
                });
                debug(1, `[AI] Persisted deckImportResolved event for ${aiName}:`, { aiPlayerId, cardCount: resolvedCards.length });
              } catch (e) {
                debugWarn(1, `[AI] Failed to persist deckImportResolved event for ${aiName}:`, e);
              }
            } else {
              debugWarn(2, `[AI] importDeckResolved not available for ${aiName}, using fallback`);
              game.state.zones = game.state.zones || {};
              (game.state.zones as any)[aiPlayerId] = {
                hand: [],
                handCount: 0,
                libraryCount: resolvedCards.length,
                graveyard: [],
                graveyardCount: 0,
              };
            }
            
            // Store deck metadata on the player object
            const playerInState = game.state.players?.find((p: any) => p.id === aiPlayerId);
            if (playerInState) {
              playerInState.deckName = finalDeckName;
              playerInState.deckId = aiConfig.deckId || (aiConfig.deckText ? `imported_${Date.now().toString(36)}_${i}` : null);
            }
          }
        }
        
        // Register with AI engine
        registerAIPlayer(gameId, aiPlayerId, aiName, strategy, difficulty);
        
        createdAIPlayers.push({
          playerId: aiPlayerId,
          name: aiName,
          strategy,
          deckLoaded,
        });
        
        // Persist AI join event as a regular 'join' event so it can be properly replayed after server restart
        // Include isAI flag and seatToken from the join result
        try {
          const seatToken = joinResult?.seatToken || `ai_token_${randomBytes(6).toString('hex')}`;
          await appendEvent(gameId, (game as any).seq || 0, 'join', {
            playerId: aiPlayerId,
            name: aiName,
            seatToken,
            spectator: false,
            isAI: true,
            strategy,
            deckId: aiConfig.deckId,
            deckLoaded,
          });
        } catch (e) {
          debugWarn(1, `[AI] Failed to persist AI join event for ${aiName}:`, e);
        }
      }
      
      // Emit success notification for all AI players
      // Note: This is an informational event for optional client-side UI feedback.
      // The actual game state is broadcast via broadcastGame() below.
      socket.emit('multipleAIPlayersCreated', {
        gameId,
        aiPlayers: createdAIPlayers,
      });
      
      // Broadcast game state - this is the authoritative update for all clients
      broadcastGame(io, game, gameId);
      
      // Trigger auto-commander selection for all AI players with decks
      createdAIPlayers.forEach((aiPlayer, index) => {
        if (aiPlayer.deckLoaded) {
          debug(1, '[AI] Triggering auto-commander selection for:', { gameId, aiPlayerId: aiPlayer.playerId });
          
          setTimeout(async () => {
            try {
              await handleAIGameFlow(io, gameId, aiPlayer.playerId);
            } catch (e) {
              debugError(1, `[AI] Error in AI game flow for ${aiPlayer.name}:`, e);
            }
          }, AI_THINK_TIME_MS * (index + 1)); // Stagger delays
        }
      });
      
    } catch (error) {
      debugError(1, '[AI] Error creating game with multiple AI opponents:', error);
      socket.emit('error', { code: 'AI_CREATE_FAILED', message: 'Failed to create AI opponents' });
    }
  });
  
  // Add AI to existing game
  socket.on('addAIToGame', async ({
    gameId,
    aiName,
    aiStrategy,
    aiDifficulty,
    aiDeckId,
  }: {
    gameId: string;
    aiName?: string;
    aiStrategy?: string;
    aiDifficulty?: number;
    aiDeckId?: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      if (!game) {
        socket.emit('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
        return;
      }
      
      const aiPlayerId = `ai_${Date.now().toString(36)}`;
      const strategy = (aiStrategy as AIStrategy) || AIStrategy.BASIC;
      const difficulty = aiDifficulty ?? 0.5;
      
      // Add AI to game state
      game.state = (game.state || {}) as any;
      game.state.players = game.state.players || [];
      game.state.players.push({
        id: aiPlayerId,
        name: aiName || 'AI Opponent',
        life: (game.state as any).startingLife || 40,
        isAI: true,
        strategy: strategy,
        difficulty: difficulty,
      } as any);
      
      // Register with AI engine
      registerAIPlayer(gameId, aiPlayerId, aiName || 'AI Opponent', strategy, difficulty);
      
      socket.emit('aiPlayerCreated', { gameId, aiPlayerId, aiName: aiName || 'AI Opponent', strategy, difficulty });
      broadcastGame(io, game, gameId);
      
    } catch (error) {
      debugError(1, '[AI] Error adding AI to game:', error);
      socket.emit('error', { code: 'AI_ADD_FAILED', message: 'Failed to add AI opponent' });
    }
  });
  
  // List available decks for AI
  socket.on('listDecksForAI', () => {
    try {
      const decks = listDecks();
      socket.emit('decksForAI', { decks });
    } catch (error) {
      debugError(1, '[AI] Error listing decks for AI:', error);
      socket.emit('decksForAI', { decks: [], error: 'Failed to list decks' });
    }
  });
  
  // Remove AI from game
  socket.on('removeAIFromGame', async ({
    gameId,
    aiPlayerId,
  }: {
    gameId: string;
    aiPlayerId: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      if (!game) {
        socket.emit('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
        return;
      }
      
      // Remove from AI registry
      unregisterAIPlayer(gameId, aiPlayerId);
      
      // Remove from game state
      if (game.state && Array.isArray(game.state.players)) {
        game.state.players = game.state.players.filter((p: any) => p.id !== aiPlayerId);
      }
      
      socket.emit('aiPlayerRemoved', { gameId, aiPlayerId });
      broadcastGame(io, game, gameId);
      
    } catch (error) {
      debugError(1, '[AI] Error removing AI from game:', error);
      socket.emit('error', { code: 'AI_REMOVE_FAILED', message: 'Failed to remove AI opponent' });
    }
  });

  /**
   * Toggle AI control for a human player
   * Allows a player to enable/disable AI autopilot for their seat
   */
  socket.on('toggleAIControl', async ({
    gameId,
    enable,
    strategy,
    difficulty,
  }: {
    gameId: string;
    enable: boolean;
    strategy?: string;
    difficulty?: number;
  }) => {
    try {
      const playerId = socket.data.playerId as PlayerID | undefined;
      if (!playerId || socket.data.spectator) {
        socket.emit('error', { code: 'NOT_PLAYER', message: 'Only players can toggle AI control' });
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
        return;
      }

      // Check if player is in the game
      const players = game.state?.players || [];
      const playerInGame = players.find((p: any) => p.id === playerId);
      if (!playerInGame) {
        socket.emit('error', { code: 'NOT_IN_GAME', message: 'You are not in this game' });
        return;
      }

      if (enable) {
        // Enable AI control for this player
        const aiStrategy = (strategy as AIStrategy) || AIStrategy.BASIC;
        const aiDifficulty = difficulty ?? 0.5;
        
        registerAIPlayer(gameId, playerId, playerInGame.name || 'Player', aiStrategy, aiDifficulty);
        
        // Store AI control state on the player (cast to any for dynamic properties)
        (playerInGame as any).aiControlled = true;
        (playerInGame as any).aiStrategy = aiStrategy;
        (playerInGame as any).aiDifficulty = aiDifficulty;
        
        debug(1, '[AI] AI control enabled for player:', { gameId, playerId, strategy: aiStrategy, difficulty: aiDifficulty });
        
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${playerInGame.name || 'Player'} enabled AI control (${aiStrategy} strategy).`,
          ts: Date.now(),
        });
        
        // If it's this player's turn or they have priority, trigger AI action
        const hasPriority = game.state?.priority === playerId;
        if (hasPriority) {
          // Delay briefly to allow state to update
          setTimeout(() => {
            handleAIPriority(io, gameId, playerId);
          }, AI_THINK_TIME_MS);
        }
      } else {
        // Disable AI control for this player
        unregisterAIPlayer(gameId, playerId);
        
        (playerInGame as any).aiControlled = false;
        delete (playerInGame as any).aiStrategy;
        delete (playerInGame as any).aiDifficulty;
        
        debug(1, '[AI] AI control disabled for player:', { gameId, playerId });
        
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${playerInGame.name || 'Player'} disabled AI control.`,
          ts: Date.now(),
        });
      }

      // Emit update to the specific player
      socket.emit('aiControlToggled', { 
        gameId, 
        playerId, 
        enabled: enable,
        strategy: enable ? (strategy || 'basic') : undefined,
        difficulty: enable ? (difficulty ?? 0.5) : undefined,
      });
      
      // Bump game sequence and broadcast
      if (typeof (game as any).bumpSeq === 'function') {
        (game as any).bumpSeq();
      }
      
      broadcastGame(io, game, gameId);
      
    } catch (error) {
      debugError(1, '[AI] Error toggling AI control:', error);
      socket.emit('error', { code: 'AI_TOGGLE_FAILED', message: 'Failed to toggle AI control' });
    }
  });

  /**
   * Get available AI strategies for the UI
   */
  socket.on('getAIStrategies', () => {
    socket.emit('aiStrategies', {
      strategies: [
        { id: 'basic', name: 'Basic', description: 'Simple decision-making for fast gameplay' },
        { id: 'aggressive', name: 'Aggressive', description: 'Prioritizes attacking and dealing damage' },
        { id: 'defensive', name: 'Defensive', description: 'Focuses on blocking and survival' },
        { id: 'control', name: 'Control', description: 'Values card advantage and removal' },
      ],
    });
  });
}

/**
 * Clean up AI players when game ends
 */
export function cleanupGameAI(gameId: string): void {
  const gameAIs = aiPlayers.get(gameId);
  if (gameAIs) {
    for (const playerId of gameAIs.keys()) {
      aiEngine.unregisterAI(playerId);
    }
    aiPlayers.delete(gameId);
    debug(1, '[AI] Cleaned up AI players for game:', gameId);
  }
}

/**
 * Check if there are any pending library searches for a game
 */
/**
 * Check if there are any pending bounce land choices for a game
 * @deprecated Bounce land choices now use the resolution queue
 */
function hasPendingBounceLandChoice(game: any): boolean {
  const pending = (game.state as any)?.pendingBounceLandChoice;
  return pending && typeof pending === 'object' && Object.keys(pending).length > 0;
}

/**
 * Check if there are any pending modals that should block AI advancement.
 * Returns an object with a boolean flag and optional reason string.
 */
function checkPendingModals(game: any, gameId: string): { hasPending: boolean; reason?: string } {
  // Check the resolution queue (unified system for all player interactions)
  const queueSummary = ResolutionQueueManager.getPendingSummary(gameId);
  if (queueSummary.hasPending) {
    const pendingTypes = queueSummary.pendingTypes.join(', ');
    return { hasPending: true, reason: `players have pending resolution steps: ${pendingTypes}` };
  }
  
  // Check legacy pending* fields that haven't been migrated yet
  if (hasPendingColorChoices(gameId)) {
    return { hasPending: true, reason: 'players have pending color choice modals' };
  }
  if (hasPendingCreatureTypeSelections(gameId)) {
    return { hasPending: true, reason: 'players have pending creature type selection modals' };
  }
  if (hasPendingJoinForcesOrOffers(gameId)) {
    return { hasPending: true, reason: 'players have pending Join Forces or Tempting Offer modals' };
  }
  return { hasPending: false };
}

/**
 * Handle pending library search effects after stack resolution.
 * For AI players, auto-selects the best card; for human players, emits the request.
 */
/**
 * Handle pending control change activations after stack resolution for AI players.
 * This handles cards like Vislor Turlough, Xantcha, Akroan Horse that have ETB control change effects.
 * AI players need to auto-select an opponent to give control to.
 */
async function handlePendingControlChangesAfterResolution(
  io: Server,
  game: any,
  gameId: string
): Promise<void> {
  try {
    const pendingActivations = (game.state as any)?.pendingControlChangeActivations;
    if (!pendingActivations || typeof pendingActivations !== 'object') return;
    
    const activationIds = Object.keys(pendingActivations);
    if (activationIds.length === 0) return;
    
    for (const activationId of activationIds) {
      const pending = pendingActivations[activationId];
      if (!pending) continue;
      
      const playerId = pending.playerId;
      
      // Only handle AI players
      if (!isAIPlayer(gameId, playerId)) continue;
      
      debug(2, `[AI] Handling pending control change for ${pending.cardName} (activation: ${activationId})`);
      
      // Find the permanent on battlefield
      const permanent = game.state.battlefield?.find((p: any) => p?.id === pending.permanentId);
      if (!permanent) {
        // Permanent no longer exists - clean up
        delete pendingActivations[activationId];
        continue;
      }
      
      // Get available opponents
      const players = game.state?.players || [];
      const opponents = players.filter((p: any) => 
        p && p.id !== playerId && !(p as any).hasLost && !(p as any).eliminated
      );
      
      if (opponents.length === 0) {
        // No valid opponents - clean up
        delete pendingActivations[activationId];
        continue;
      }
      
      // For optional control changes (Vislor Turlough), AI decides whether to give control
      if (pending.isOptional) {
        // AI typically wants to keep creatures, but Vislor's goad effect is beneficial
        const shouldGiveControl = pending.goadsOnChange || Math.random() < AI_OPTIONAL_GIVE_CONTROL_PROBABILITY;
        
        if (!shouldGiveControl) {
          // AI declines to give control
          delete pendingActivations[activationId];
          debug(2, `[AI] Declined to give control of ${pending.cardName}`);
          continue;
        }
      }
      
      // AI selects a random opponent
      const randomOpponent = opponents[Math.floor(Math.random() * opponents.length)];
      
      // Apply control change
      const oldController = permanent.controller;
      permanent.controller = randomOpponent.id;
      
      // Apply goad if needed
      if (pending.goadsOnChange) {
        permanent.goadedBy = permanent.goadedBy || [];
        if (!permanent.goadedBy.includes(playerId)) {
          permanent.goadedBy.push(playerId);
        }
      }
      
      // Apply attack restrictions
      if (pending.mustAttackEachCombat) {
        permanent.mustAttackEachCombat = true;
      }
      if (pending.cantAttackOwner) {
        permanent.cantAttackOwner = true;
        permanent.ownerId = playerId;
      }
      
      // Clean up pending activation
      delete pendingActivations[activationId];
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `🔄 Control of ${pending.cardName} changed from ${getPlayerName(game, oldController)} to ${getPlayerName(game, randomOpponent.id)}.${pending.goadsOnChange ? ` ${pending.cardName} is goaded.` : ''}`,
        ts: Date.now(),
      });
      
      debug(2, `[AI] Auto-gave control of ${pending.cardName} to ${randomOpponent.name || randomOpponent.id}`);
      
      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }
    }
    
    broadcastGame(io, game, gameId);
  } catch (err) {
    debugWarn(1, '[handlePendingControlChangesAfterResolution] Error:', err);
  }
}

/**
 * Get player display name
 */
function getPlayerName(game: any, playerId: string): string {
  const player = game.state?.players?.find((p: any) => p?.id === playerId);
  return player?.name || playerId;
}


