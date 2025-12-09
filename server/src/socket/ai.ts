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

/** AI timing delays for more natural behavior */
const AI_THINK_TIME_MS = 500;
const AI_REACTION_DELAY_MS = 300;

/** Maximum cards to retrieve when searching the entire library for commander selection */
const MAX_LIBRARY_SEARCH_LIMIT = 1000;

/** Initial hand size for commander format (7 cards) */
const INITIAL_HAND_SIZE = 7;

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
 * - Any card with "can be your commander" text
 */
function isValidCommander(card: any): boolean {
  const typeLine = (card.type_line || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Must be legendary
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
 * Calculate how well a set of commanders covers the deck's color identity
 * Returns the number of deck colors that are covered by the commanders
 */
function calculateColorCoverage(commanders: any[], deckColors: Set<string>): number {
  const commanderColors = new Set<string>();
  for (const commander of commanders) {
    const colors = extractColorIdentity(commander);
    for (const color of colors) {
      commanderColors.add(color);
    }
  }
  
  let coverage = 0;
  for (const color of deckColors) {
    if (commanderColors.has(color)) {
      coverage++;
    }
  }
  return coverage;
}

/**
 * Find the best commander(s) from a deck's card list
 * Returns 1 or 2 commanders based on partner/background rules
 * 
 * Priority order:
 * 1. Check first 1-2 cards in decklist (commanders are typically listed first)
 *    - BUT validate that partner pairs cover the deck's color identity
 * 2. Look for partner pairs that best match deck colors
 * 3. Look for commander+background pairs
 * 4. Fall back to first valid commander candidate
 * 
 * Also calculates combined color identity of the selected commander(s)
 */
function findBestCommanders(cards: any[]): { commanders: any[]; colorIdentity: string[] } {
  // Find all valid commander candidates
  const candidates = cards.filter(isValidCommander);
  
  if (candidates.length === 0) {
    console.warn('[AI] No valid commander candidates found in deck');
    return { commanders: [], colorIdentity: [] };
  }
  
  // Calculate the deck's overall color identity
  const deckColors = calculateDeckColorIdentity(cards);
  console.info('[AI] Deck color identity:', Array.from(deckColors).join(''));
  
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
      // Validate that these partners cover the deck's color identity
      const coverage = calculateColorCoverage(firstTwoCandidates, deckColors);
      if (coverage === deckColors.size || deckColors.size === 0) {
        // Perfect match - use these commanders
        selectedCommanders = firstTwoCandidates;
        console.info('[AI] Selected partner commanders from first 2 cards (full color coverage):', selectedCommanders.map(c => c.name));
      } else {
        // Partners don't cover all deck colors - look for better options
        console.warn('[AI] First 2 partner commanders only cover', coverage, 'of', deckColors.size, 'deck colors');
        // Fall through to Priority 2 to find better partners
        // DO NOT select a single commander here - we need partners for multi-color decks
      }
    }
    // Check if first two cards are commander + background pair
    else if (firstTwoCandidates.length >= 1 && selectedCommanders.length === 0) {
      const firstCard = firstTwoCandidates[0];
      const secondCard = firstTwoCards[1];
      
      if (hasBackground(firstCard) && secondCard && 
          (secondCard.type_line || '').toLowerCase().includes('background')) {
        selectedCommanders = [firstCard, secondCard];
        console.info('[AI] Selected commander + background from first 2 cards:', selectedCommanders.map(c => c.name));
      } else if (secondCard && isValidCommander(secondCard) &&
                 (secondCard.type_line || '').toLowerCase().includes('background') && 
                 hasBackground(firstCard)) {
        selectedCommanders = [firstCard, secondCard];
        console.info('[AI] Selected commander + background from first 2 cards:', selectedCommanders.map(c => c.name));
      } else {
        // Validate that the first card covers the deck's color identity
        // Safe to access firstCard since we checked length >= 1 above
        const firstCardCoverage = calculateColorCoverage([firstCard], deckColors);
        if (firstCardCoverage === deckColors.size || deckColors.size === 0) {
          // First card covers all deck colors - use it
          selectedCommanders = [firstCard];
          console.info(`[AI] Selected single commander from first card (full color coverage): ${firstCard.name}`);
        } else {
          // First card doesn't cover all deck colors
          // Don't use it as a single commander - look for partner pairs instead
          console.warn(`[AI] First commander only covers ${firstCardCoverage} of ${deckColors.size} deck colors - searching for partner pairs`);
          // Fall through to Priority 2 to find better partners
        }
      }
    }
  }
  
  // Priority 2: If no commanders found or first 2 didn't cover colors, find best partner pair
  if (selectedCommanders.length === 0 && partnerCandidates.length >= 2) {
    // Find the partner pair that best covers the deck's color identity
    let bestPair: any[] = [];
    let bestCoverage = 0;
    
    for (let i = 0; i < partnerCandidates.length; i++) {
      for (let j = i + 1; j < partnerCandidates.length; j++) {
        const pair = [partnerCandidates[i], partnerCandidates[j]];
        const coverage = calculateColorCoverage(pair, deckColors);
        if (coverage > bestCoverage) {
          bestCoverage = coverage;
          bestPair = pair;
        }
        // If we found perfect coverage, stop searching
        if (coverage === deckColors.size) {
          break;
        }
      }
      // If we found perfect coverage, stop searching
      if (bestCoverage === deckColors.size) {
        break;
      }
    }
    
    if (bestPair.length === 2) {
      selectedCommanders = bestPair;
      console.info(`[AI] Selected partner commanders with best color coverage (${bestCoverage}/${deckColors.size}):`, selectedCommanders.map(c => c.name));
    } else {
      // Fallback to first 2 partners if no pair found
      selectedCommanders = partnerCandidates.slice(0, 2);
      console.info('[AI] Selected partner commanders (fallback):', selectedCommanders.map(c => c.name));
    }
  }
  
  // Priority 3: Check for background pair
  if (selectedCommanders.length === 0 && 
      chooseBackgroundCandidates.length > 0 && backgroundCandidates.length > 0) {
    selectedCommanders = [chooseBackgroundCandidates[0], backgroundCandidates[0]];
    console.info('[AI] Selected commander + background:', selectedCommanders.map(c => c.name));
  }
  
  // Priority 4: Find the single commander that best covers the deck's color identity
  if (selectedCommanders.length === 0) {
    let bestCommander: any = null;
    let bestCoverage = 0;
    
    for (const candidate of candidates) {
      const coverage = calculateColorCoverage([candidate], deckColors);
      if (coverage > bestCoverage) {
        bestCoverage = coverage;
        bestCommander = candidate;
      }
      // If we found perfect coverage, stop searching
      if (coverage === deckColors.size) {
        break;
      }
    }
    
    if (bestCommander) {
      selectedCommanders = [bestCommander];
      console.info(`[AI] Selected single commander with best color coverage (${bestCoverage}/${deckColors.size}): ${bestCommander.name}`);
    } else {
      // Ultimate fallback - just use first candidate
      selectedCommanders = [candidates[0]];
      console.warn('[AI] No commanders found with good color coverage, using first candidate:', candidates[0]?.name);
    }
  }
  
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
      console.warn('[AI] autoSelectAICommander: game not found', { gameId, playerId });
      return false;
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
      console.warn('[AI] autoSelectAICommander: no cards in library', { gameId, playerId });
      return false;
    }
    
    // Validate that library cards have required data (name, type_line, etc.)
    const cardsForSelection = library.filter((c: any) => c && c.name && c.type_line);
    if (cardsForSelection.length === 0) {
      console.error('[AI] autoSelectAICommander: library has cards but they lack required data', {
        gameId,
        playerId,
        totalCards: library.length,
        sampleCard: library[0],
      });
      return false;
    }
    
    if (cardsForSelection.length < library.length) {
      console.warn('[AI] autoSelectAICommander: filtered out cards lacking required data', {
        gameId,
        playerId,
        totalCards: library.length,
        validCards: cardsForSelection.length,
      });
    }
    
    console.info('[AI] autoSelectAICommander: found library with', cardsForSelection.length, 'cards');
    
    // Log the first few cards to help debug commander selection
    if (cardsForSelection.length > 0) {
      const firstCards = cardsForSelection.slice(0, 3).map((c: any) => ({
        name: c.name,
        type: c.type_line,
        colors: c.color_identity || [],
      }));
      console.info('[AI] First cards in library:', JSON.stringify(firstCards));
    }
    
    // Find the best commander(s) from the deck (uses original unshuffled order)
    let { commanders, colorIdentity } = findBestCommanders(cardsForSelection);
    
    if (commanders.length === 0) {
      console.warn('[AI] autoSelectAICommander: no valid commander found', { gameId, playerId });
      // Fallback: just pick the first legendary card if any
      const legendary = cardsForSelection.find((c: any) => 
        (c?.type_line || '').toLowerCase().includes('legendary')
      );
      if (legendary) {
        console.warn('[AI] Using fallback legendary as commander:', legendary.name);
        // Create new arrays with the fallback commander
        commanders = [legendary];
        const fallbackColors = extractColorIdentity(legendary);
        colorIdentity = [...fallbackColors];
      } else {
        console.error('[AI] No legendary cards found in deck, cannot set commander');
        return false;
      }
    }
    
    // Set commander using the game's setCommander function
    const commanderNames = commanders.map((c: any) => c.name);
    const commanderIds = commanders.map((c: any) => c.id);
    
    console.info('[AI] Auto-selecting commander for AI:', {
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
      
      console.info('[AI] After setCommander - hand count:', handCount);
      
      // If hand is empty, manually trigger shuffle and draw
      // (This is a fallback if the pendingInitialDraw didn't work)
      let didManualDraw = false;
      if (handCount === 0) {
        console.info('[AI] Hand is empty after setCommander, manually triggering shuffle and draw');
        didManualDraw = true;
        
        // Shuffle the library
        if (typeof (game as any).shuffleLibrary === 'function') {
          (game as any).shuffleLibrary(playerId);
          console.info('[AI] Library shuffled');
        }
        
        // Draw initial hand
        if (typeof (game as any).drawCards === 'function') {
          const drawn = (game as any).drawCards(playerId, INITIAL_HAND_SIZE);
          console.info('[AI] Drew', drawn?.length || 0, 'cards');
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
          console.info('[AI] Persisted opening draw events (shuffle + draw) for player', playerId);
        }
      } catch (e) {
        console.warn('[AI] Failed to persist setCommander event:', e);
      }
      
      // Broadcast updated state to all players
      broadcastGame(io, game, gameId);
      
      console.info('[AI] Commander set for AI player:', {
        gameId,
        playerId,
        commanderNames,
        finalHandCount: game.state.zones?.[playerId]?.handCount,
      });
      
      return true;
    } else {
      console.error('[AI] game.setCommander not available');
      return false;
    }
    
  } catch (error) {
    console.error('[AI] Error auto-selecting commander:', error);
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
    console.info('[AI] handleAIGameFlow: AI player has lost the game, skipping:', { gameId, playerId });
    return;
  }
  
  // Check if this AI player is in the inactive set
  const ctx = (game as any).ctx || game;
  const inactiveSet = ctx.inactive instanceof Set ? ctx.inactive : new Set();
  if (inactiveSet.has(playerId)) {
    console.info('[AI] handleAIGameFlow: AI player is inactive, skipping:', { gameId, playerId });
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
  
  console.info('[AI] handleAIGameFlow:', {
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
      console.info('[AI] AI needs to select commander');
      
      // Small delay to allow deck to be fully set up
      setTimeout(async () => {
        const success = await autoSelectAICommander(io, gameId, playerId);
        if (success) {
          console.info('[AI] Commander selection complete, continuing game flow');
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
        // AI automatically keeps hand - set mulligan state
        console.info('[AI] AI automatically keeping hand');
        
        (game.state as any).mulliganState = (game.state as any).mulliganState || {};
        (game.state as any).mulliganState[playerId] = {
          hasKeptHand: true,
          mulligansTaken: 0,
        };
        
        // Bump sequence to propagate state change
        if (typeof (game as any).bumpSeq === 'function') {
          (game as any).bumpSeq();
        }
        
        console.info('[AI] AI is ready to start game (hand kept)');
        
        // Broadcast updated state so human players see AI has kept hand
        broadcastGame(io, game, gameId);
        
        // After keeping hand, re-trigger game flow to check for advancement
        setTimeout(() => handleAIGameFlow(io, gameId, playerId), AI_THINK_TIME_MS);
        return;
      }
      
      // AI has already kept hand - now check if we should advance from pre_game
      // This happens when:
      // 1. AI is the active player (turnPlayer)
      // 2. All players have kept their hands
      // 3. All pending Leyline/opening hand actions are resolved
      if (isAITurn) {
        console.info('[AI] AI is active player in pre_game, checking if ready to advance');
        
        // Get mulligan state for checking hand keeping status
        const mulliganState = (game.state as any).mulliganState || {};
        
        // Check if all players have kept their hands
        const allPlayers = players.filter((p: any) => p && !p.spectator);
        const allKeptHands = allPlayers.every((p: any) => {
          const pMulliganState = mulliganState[p.id];
          return pMulliganState && pMulliganState.hasKeptHand;
        });
        
        if (!allKeptHands) {
          console.info('[AI] Waiting for other players to keep their hands');
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
              console.info(`[AI] Player ${pid} has Leyline cards, waiting for resolution`);
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
        
        // All conditions met - advance from pre_game to beginning phase (MAIN1)
        console.info('[AI] All players ready, AI advancing from pre_game to beginning phase');
        
        try {
          // Use nextStep to advance from pre_game to the first turn
          // This will set up UNTAP step and immediately advance to UPKEEP, then to MAIN1
          if (typeof (game as any).nextStep === 'function') {
            (game as any).nextStep();
            console.info('[AI] Advanced game from pre_game to beginning phase');
            
            // Persist the event
            const gameSeq = (game as any).seq;
            if (typeof gameSeq !== 'number') {
              console.error('[AI] game.seq is not a number, cannot persist event');
            } else {
              try {
                await appendEvent(gameId, gameSeq, 'nextStep', {
                  playerId,
                  reason: 'ai_pregame_advance',
                  isAI: true,
                });
              } catch (e) {
                console.warn('[AI] Failed to persist nextStep event:', e);
              }
            }
            
            // Broadcast updated state
            broadcastGame(io, game, gameId);
            
            // Re-trigger AI game flow to handle the new phase
            setTimeout(() => handleAIGameFlow(io, gameId, playerId), AI_THINK_TIME_MS);
          } else {
            console.error('[AI] game.nextStep not available');
          }
        } catch (err) {
          console.error('[AI] Error advancing from pre_game:', err);
        }
        
        return;
      } else {
        console.info('[AI] AI has kept hand but is not active player, waiting');
      }
    }
    return;
  }
  
  // Active game phases: handle priority if AI has it
  if (hasPriority) {
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
    console.info('[AI] Added AI player to auto-pass set:', { gameId, playerId });
  }
  
  console.info('[AI] Registered AI player:', { gameId, playerId, name, strategy, difficulty });
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
      console.info('[AI] Removed AI player from auto-pass set:', { gameId, playerId });
    }
  }
  
  console.info('[AI] Unregistered AI player:', { gameId, playerId });
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
function calculateAvailableMana(game: any, playerId: PlayerID): { total: number; colors: Record<string, number>; sourcesByColor: Map<string, string[]> } {
  const battlefield = game.state?.battlefield || [];
  const colors: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const sourcesByColor = new Map<string, string[]>();
  let total = 0;
  
  // Initialize sourcesByColor
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) {
    sourcesByColor.set(color, []);
  }
  
  for (const perm of battlefield) {
    if (perm && perm.controller === playerId && !perm.tapped) {
      // Check if this permanent can produce mana
      if (!hasManaAbility(perm.card)) continue;
      
      // Creatures with summoning sickness can't tap for mana
      if (hasCreatureSummoningSickness(perm)) continue;
      
      const producedColors = getManaProduction(perm.card);
      if (producedColors.length === 0) continue;
      
      // Check if this source produces 2 mana (Sol Ring, Mana Crypt, etc.)
      const oracleText = (perm.card?.oracle_text || '').toLowerCase();
      const producesTwoColorless = oracleText.includes('{c}{c}') || oracleText.includes('add {c}{c}');
      total += producesTwoColorless ? 2 : 1;
      
      // Track which sources can produce each color
      for (const color of producedColors) {
        const sources = sourcesByColor.get(color) || [];
        sources.push(perm.id);
        sourcesByColor.set(color, sources);
        // The color count represents how many sources CAN produce this color
        colors[color] = (colors[color] || 0) + (producesTwoColorless && color === 'C' ? 2 : 1);
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
function findCastableSpells(game: any, playerId: PlayerID): any[] {
  const zones = game.state?.zones?.[playerId];
  const hand = Array.isArray(zones?.hand) ? zones.hand : [];
  const availableMana = calculateAvailableMana(game, playerId);
  
  const castable: any[] = [];
  
  for (const card of hand) {
    const typeLine = (card?.type_line || '').toLowerCase();
    
    // Skip lands
    if (typeLine.includes('land')) continue;
    
    // Skip cards without mana cost (usually special cards)
    const manaCost = card?.mana_cost;
    if (!manaCost) continue;
    
    // Parse cost and check affordability
    const cost = parseSpellCost(manaCost);
    if (canAffordSpell(availableMana, cost)) {
      castable.push({
        card,
        cost,
        typeLine,
        priority: calculateSpellPriority(card, game, playerId),
      });
    }
  }
  
  // Sort by priority (highest first)
  castable.sort((a, b) => b.priority - a.priority);
  
  return castable;
}

/**
 * Calculate priority for casting a spell (higher = cast first)
 */
function calculateSpellPriority(card: any, game: any, playerId: PlayerID): number {
  let priority = 50; // Base priority
  const typeLine = (card?.type_line || '').toLowerCase();
  const oracleText = (card?.oracle_text || '').toLowerCase();
  
  // Creatures are good for board presence
  if (typeLine.includes('creature')) {
    priority += 30;
  }
  
  // Artifacts and enchantments that help are good
  if (typeLine.includes('artifact') || typeLine.includes('enchantment')) {
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
  
  // Ramp is valuable early
  if (oracleText.includes('search your library') && oracleText.includes('land')) {
    priority += 15;
  }
  
  // Lower CMC spells get slight priority (play on curve)
  const cost = parseSpellCost(card?.mana_cost || '');
  priority += Math.max(0, 10 - cost.cmc);
  
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
 * Choose cards for AI to discard - prioritizes keeping lands and low-cost spells
 */
function chooseCardsToDiscard(game: any, playerId: PlayerID, discardCount: number): string[] {
  const zones = game.state?.zones?.[playerId];
  const hand = Array.isArray(zones?.hand) ? zones.hand : [];
  
  if (hand.length <= discardCount) {
    return hand.map((c: any) => c.id);
  }
  
  // Score cards - lower score = more likely to discard
  const scoredCards = hand.map((card: any) => {
    let score = 50; // Base score
    const typeLine = (card?.type_line || '').toLowerCase();
    const manaCost = card?.mana_cost || '';
    
    // Keep lands (high priority)
    if (typeLine.includes('land')) {
      score += 100;
    }
    
    // Keep low-cost spells (easier to cast)
    // Calculate approximate CMC by counting generic mana + number of colored symbols
    const genericMatch = manaCost.match(/\d+/);
    const generic = genericMatch ? parseInt(genericMatch[0], 10) : 0;
    const coloredSymbols = (manaCost.match(/\{[WUBRG]\}/gi) || []).length;
    const approxCMC = generic + coloredSymbols;
    score += Math.max(0, 10 - approxCMC);
    
    // Keep creatures (good for board presence)
    if (typeLine.includes('creature')) {
      score += 20;
    }
    
    // Keep removal spells
    const oracleText = (card?.oracle_text || '').toLowerCase();
    if (oracleText.includes('destroy') || oracleText.includes('exile')) {
      score += 30;
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
    console.warn('[AI] handleAIPriority: game not found', { gameId, playerId });
    return;
  }
  
  // Check if this AI player has lost the game
  const players = game.state.players || [];
  const aiPlayer = players.find((p: any) => p.id === playerId);
  if (aiPlayer?.hasLost) {
    console.info('[AI] AI player has lost the game, skipping priority handling:', { gameId, playerId });
    return;
  }
  
  // Check if this AI player is in the inactive set
  const ctx = (game as any).ctx || game;
  const inactiveSet = ctx.inactive instanceof Set ? ctx.inactive : new Set();
  if (inactiveSet.has(playerId)) {
    console.info('[AI] AI player is inactive, skipping priority handling:', { gameId, playerId });
    return;
  }
  
  const phase = String(game.state.phase || '').toLowerCase();
  const step = String((game.state as any).step || '').toLowerCase();
  const isAITurn = game.state.turnPlayer === playerId;
  const stackEmpty = !game.state.stack || game.state.stack.length === 0;
  const hasPriority = game.state.priority === playerId;
  
  console.info('[AI] AI player checking priority:', { 
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
    console.info('[AI] Cleanup step - handling automatic cleanup actions (Rule 514.1)');
    
    // Only handle cleanup if it's the AI's turn
    // (Cleanup doesn't grant priority per Rule 514.1, so we only act if we're the turn player)
    if (isAITurn) {
      const { needsDiscard, discardCount } = needsToDiscard(game, playerId);
      
      if (needsDiscard) {
        console.info('[AI] Cleanup step - AI needs to discard', discardCount, 'cards');
        await executeAIDiscard(io, gameId, playerId, discardCount);
        return;
      }
      
      // No discard needed - cleanup is complete, auto-advance
      console.info('[AI] Cleanup step - no discard needed, auto-advancing');
      await executeAdvanceStep(io, gameId, playerId);
      return;
    } else {
      // Not AI's turn - don't act during cleanup (per Rule 514.1, cleanup doesn't grant priority)
      console.info('[AI] Cleanup step - not AI turn, skipping');
      return;
    }
  }
  
  // Critical check: AI should NOT act if it doesn't have priority
  // This prevents the AI from getting into an infinite loop of passing priority
  // and prevents the AI from advancing during opponent's turn
  if (!hasPriority) {
    console.info('[AI] AI does not have priority, skipping action');
    return;
  }
  
  console.info('[AI] AI has priority, proceeding with action');
  
  try {
    // CRITICAL: Check for pending trigger ordering BEFORE any other action
    // This prevents the AI from getting stuck in an infinite loop trying to advance
    // while trigger ordering is pending
    const pendingTriggerOrdering = (game.state as any).pendingTriggerOrdering?.[playerId];
    if (pendingTriggerOrdering) {
      console.info('[AI] AI has pending trigger ordering, auto-ordering triggers');
      await executeAITriggerOrdering(io, gameId, playerId);
      return; // After ordering triggers, we'll get called again via broadcastGame
    }
    
    // Also check for triggers in the trigger queue that need ordering
    const triggerQueue = (game.state as any).triggerQueue || [];
    const aiTriggers = triggerQueue.filter((t: any) => 
      t.controllerId === playerId && t.type === 'order'
    );
    if (aiTriggers.length >= 2) {
      console.info(`[AI] AI has ${aiTriggers.length} triggers to order in queue`);
      await executeAITriggerOrdering(io, gameId, playerId);
      return;
    }
    
    // CRITICAL: Check for stuck pendingSpellCasts that could cause infinite loops
    // This can happen when a spell with targets gets stuck in the targeting workflow
    // Clean up any pendingSpellCasts that belong to this AI player
    const pendingSpellCasts = (game.state as any).pendingSpellCasts || {};
    const aiPendingCasts = Object.keys(pendingSpellCasts).filter(effectId => 
      pendingSpellCasts[effectId]?.playerId === playerId
    );
    if (aiPendingCasts.length > 0) {
      console.warn(`[AI] Cleaning up ${aiPendingCasts.length} stuck pending spell cast(s) to prevent infinite loop`);
      for (const effectId of aiPendingCasts) {
        const castInfo = pendingSpellCasts[effectId];
        console.warn(`[AI] Removing stuck spell cast: ${castInfo?.cardName || 'unknown'} (effectId: ${effectId})`);
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
        console.info('[AI] Not AI turn, but it\'s DECLARE_BLOCKERS step - AI needs to decide on blockers');
        
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
      console.info('[AI] Not AI turn, passing priority');
      await executePassPriority(io, gameId, playerId);
      return;
    }
    
    // If there's something on the stack, let it resolve
    if (!stackEmpty) {
      console.info('[AI] Stack not empty, passing priority to let it resolve');
      await executePassPriority(io, gameId, playerId);
      return;
    }
    
    // Handle different phases/steps
    
    // MAIN PHASES: Play lands and cast spells
    const isMainPhase = phase.includes('main') || step.includes('main');
    
    if (isMainPhase) {
      // Try to play a land first
      if (canAIPlayLand(game, playerId)) {
        const landCard = findPlayableLand(game, playerId);
        if (landCard) {
          console.info('[AI] Playing land:', landCard.name);
          await executeAIPlayLand(io, gameId, playerId, landCard.id);
          // After playing land, continue with more actions
          setTimeout(() => {
            handleAIPriority(io, gameId, playerId).catch(console.error);
          }, AI_THINK_TIME_MS);
          return;
        }
      }
      
      // Try to use activated abilities (before casting spells)
      // This prioritizes card draw and other beneficial effects
      const abilityDecision = await aiEngine.makeDecision({
        gameState: game.state as any,
        playerId,
        decisionType: AIDecisionType.ACTIVATE_ABILITY,
        options: [],
      });
      
      if (abilityDecision.action?.activate) {
        console.info('[AI] Activating ability:', abilityDecision.action.cardName, '-', abilityDecision.reasoning);
        await executeAIActivateAbility(io, gameId, playerId, abilityDecision.action);
        // After activating ability, continue with more actions
        setTimeout(() => {
          handleAIPriority(io, gameId, playerId).catch(console.error);
        }, AI_THINK_TIME_MS);
        return;
      }
      
      // Try to cast spells
      const castableSpells = findCastableSpells(game, playerId);
      if (castableSpells.length > 0) {
        const bestSpell = castableSpells[0]; // Already sorted by priority
        console.info('[AI] Casting spell:', bestSpell.card.name, 'with priority', bestSpell.priority);
        await executeAICastSpell(io, gameId, playerId, bestSpell.card, bestSpell.cost);
        // After casting, continue with more actions
        setTimeout(() => {
          handleAIPriority(io, gameId, playerId).catch(console.error);
        }, AI_THINK_TIME_MS);
        return;
      }
      
      // No more actions, advance step (only if it's AI's turn)
      if (isAITurn) {
        console.info('[AI] Main phase, no more actions, advancing step');
        await executeAdvanceStep(io, gameId, playerId);
      } else {
        console.info('[AI] Main phase, not AI turn, passing priority');
        await executePassPriority(io, gameId, playerId);
      }
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
          console.info('[AI] Attackers already declared, passing priority for responses');
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
          console.info('[AI] No attackers to declare, passing priority');
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
          console.info('[AI] Blockers already declared, passing priority for responses');
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
          console.info('[AI] No blockers to declare, passing priority');
          await executePassPriority(io, gameId, playerId);
        }
        return;
      }
      
      // Other combat steps - just pass priority (only active player can advance combat)
      console.info('[AI] Combat step', step, '- passing priority');
      await executePassPriority(io, gameId, playerId);
      return;
    }
    
    // BEGINNING PHASES (Untap, Upkeep, Draw) - only active player can advance
    if (phase === 'beginning' || phase.includes('begin')) {
      console.info('[AI] Beginning phase, step:', step, '- passing priority');
      await executePassPriority(io, gameId, playerId);
      return;
    }
    
    // ENDING PHASE (End step) - only active player can advance
    if (phase === 'ending' || phase === 'end') {
      console.info('[AI] Ending phase, step:', step, '- passing priority');
      await executePassPriority(io, gameId, playerId);
      return;
    }
    
    // Default: pass priority instead of advancing (let the game engine handle step advancement)
    console.info('[AI] Unknown phase/step, passing priority');
    await executePassPriority(io, gameId, playerId);
    
  } catch (error) {
    console.error('[AI] Error handling AI priority:', error);
    // Fallback: try to advance step or pass priority
    try {
      if (isAITurn && stackEmpty) {
        await executeAdvanceStep(io, gameId, playerId);
      } else {
        await executePassPriority(io, gameId, playerId);
      }
    } catch (e) {
      console.error('[AI] Failed fallback action:', e);
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
  
  console.info('[AI] Playing land:', { gameId, playerId, cardId });
  
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
            console.info('[AI] Paid 2 life for shock land to enter untapped:', cardName);
          } else {
            // Life too low, enters tapped to preserve life buffer
            entersTapped = true;
          }
        } else {
          // Choose not to pay, enters tapped
          entersTapped = true;
          console.info('[AI] Shock land enters tapped (chose not to pay):', cardName);
        }
      } else if (landEntersTapped(cardToPlay)) {
        // This land always enters tapped
        entersTapped = true;
        console.info('[AI] Land enters tapped:', cardName);
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
      console.warn('[AI] Failed to persist playLand event:', e);
    }
    
    // Bump sequence
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    
    // Broadcast updated state
    broadcastGame(io, game, gameId);
    
  } catch (error) {
    console.error('[AI] Error playing land:', error);
  }
}

/**
 * Handle bounce land ETB trigger - AI must return a land to hand
 * AI prefers to return:
 * 1. Basic lands (least valuable)
 * 2. Tapped lands
 * 3. Lands that don't produce needed colors
 */
async function handleBounceLandETB(game: any, playerId: PlayerID, bounceLandName: string): Promise<void> {
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
    console.info('[AI] No lands to return for bounce land');
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
    
    console.info('[AI] Bounce land returned to hand:', landToReturn.card?.name, hasLandfallSynergy ? '(landfall synergy detected)' : '');
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
  
  console.info('[AI] Casting spell:', { gameId, playerId, cardName: card.name, cost });
  
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
        
        console.info('[AI] Selected targets for spell:', { 
          cardName: card.name, 
          targetCount: targets.length,
          targets: targets.map((t: TargetRef) => {
            const perm = battlefield.find((p: any) => p.id === t.id);
            return perm?.card?.name || t.id;
          })
        });
      } else {
        // No valid targets available - cannot cast this spell
        console.warn('[AI] Cannot cast spell - no valid targets:', card.name);
        return;
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
        
        console.info('[AI] Spell added to stack:', card.name, 'with', targets.length, 'target(s)');
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
      console.warn('[AI] Failed to persist castSpell event:', e);
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
    console.error('[AI] Error casting spell:', error);
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
  
  console.info('[AI] Activating ability:', { 
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
      console.warn('[AI] Permanent not found for ability activation:', action.permanentId);
      return;
    }
    
    const card = permanent.card;
    const abilityText = (card?.oracle_text || '').toLowerCase();
    
    // Check if this is a tap ability
    const isTapAbility = abilityText.includes('{t}:') || abilityText.includes('{t},');
    
    // Tap the permanent if it's a tap ability
    if (isTapAbility && !permanent.tapped) {
      permanent.tapped = true;
      console.info('[AI] Tapped permanent for ability:', card.name);
    }
    
    // Handle specific abilities based on oracle text
    
    // HUMBLE DEFECTOR: Draw two cards, give control to opponent
    if (abilityText.includes('draw two cards') && abilityText.includes('opponent') && abilityText.includes('control')) {
      console.info('[AI] Activating Humble Defector ability');
      
      // Draw two cards
      if (typeof (game as any).drawCards === 'function') {
        const drawn = (game as any).drawCards(playerId, 2);
        console.info('[AI] Drew', drawn?.length || 0, 'cards from Humble Defector');
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
        
        console.info('[AI] Gave control of', card.name, 'to', randomOpponent);
        
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
    // GENERIC TAP ABILITY: Put on stack
    else if (isTapAbility) {
      // For other tap abilities, put them on the stack
      game.state.stack = game.state.stack || [];
      const stackItem = {
        id: `stack_ability_${Date.now()}_${permanent.id}`,
        type: 'ability',
        controller: playerId,
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
      console.info('[AI] Added activated ability to stack:', card.name);
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
      console.warn('[AI] Failed to persist activateAbility event:', e);
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
    console.error('[AI] Error activating ability:', error);
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
  
  console.info('[AI] Resolving spell:', topItem.card?.name);
  
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
      console.info('[AI] Permanent entered battlefield:', card.name);
    } else {
      // Instants and sorceries go to graveyard
      const zones = game.state?.zones?.[playerId];
      if (zones) {
        zones.graveyard = zones.graveyard || [];
        (zones.graveyard as any[]).push({ ...card, zone: 'graveyard' });
        zones.graveyardCount = (zones.graveyard as any[]).length;
      }
      console.info('[AI] Spell resolved to graveyard:', card.name);
    }
    
    // Bump sequence
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    
    // Broadcast updated state
    broadcastGame(io, game, gameId);
    
  } catch (error) {
    console.error('[AI] Error resolving spell:', error);
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
  
  console.info('[AI] Discarding', discardCount, 'cards');
  
  try {
    const cardsToDiscard = chooseCardsToDiscard(game, playerId, discardCount);
    
    // Get zones
    const zones = game.state?.zones?.[playerId];
    if (!zones || !Array.isArray(zones.hand)) {
      console.warn('[AI] No hand found for discard');
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
      console.warn('[AI] Failed to persist discard event:', e);
    }
    
    // Bump sequence
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    
    // Broadcast
    broadcastGame(io, game, gameId);
    
    // After discarding, advance to next turn
    setTimeout(() => {
      executeAdvanceStep(io, gameId, playerId).catch(console.error);
    }, AI_REACTION_DELAY_MS);
    
  } catch (error) {
    console.error('[AI] Error discarding:', error);
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
  
  // Check if there are any pending modal interactions before advancing
  const pendingCheck = checkPendingModals(game, gameId);
  if (pendingCheck.hasPending) {
    console.info(`[AI] Cannot advance step - ${pendingCheck.reason}`);
    return;
  }
  
  const currentStep = String((game.state as any).step || '');
  const currentPhase = String(game.state.phase || '');
  
  console.info('[AI] Advancing step:', { gameId, playerId, currentPhase, currentStep });
  
  try {
    // Use game's nextStep method if available
    if (typeof (game as any).nextStep === 'function') {
      (game as any).nextStep();
    } else {
      console.warn('[AI] game.nextStep not available');
      return;
    }
    
    const newStep = String((game.state as any).step || '');
    const newPhase = String(game.state.phase || '');
    
    console.info('[AI] Step advanced:', { newPhase, newStep });
    
    // Persist event
    try {
      await appendEvent(gameId, (game as any).seq || 0, 'nextStep', { playerId, isAI: true });
    } catch (e) {
      console.warn('[AI] Failed to persist nextStep event:', e);
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
        handleAIPriority(io, gameId, playerId).catch(console.error);
      }, AI_THINK_TIME_MS);
    }
    
  } catch (error) {
    console.error('[AI] Error advancing step:', error);
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
  
  console.info('[AI] Executing trigger ordering:', { gameId, playerId });
  
  try {
    // Get triggers from the trigger queue that belong to this player
    const triggerQueue = (game.state as any).triggerQueue || [];
    const aiTriggers = triggerQueue.filter((t: any) => 
      t.controllerId === playerId && t.type === 'order'
    );
    
    if (aiTriggers.length === 0) {
      console.info('[AI] No triggers to order, clearing pending state');
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
    
    console.info(`[AI] Found ${aiTriggers.length} triggers to order`);
    
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
      console.info(`[AI] ⚡ Pushed trigger to stack: ${trigger.sourceName} - ${trigger.effect}`);
    }
    
    // Clear the pending trigger ordering state - CRITICAL to break the loop
    if ((game.state as any).pendingTriggerOrdering) {
      delete (game.state as any).pendingTriggerOrdering[playerId];
      if (Object.keys((game.state as any).pendingTriggerOrdering).length === 0) {
        delete (game.state as any).pendingTriggerOrdering;
      }
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
      console.warn('[AI] Failed to persist orderTriggers event:', e);
    }
    
    // Bump sequence and broadcast
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    
    broadcastGame(io, game, gameId);
    
    console.info(`[AI] Successfully ordered ${aiTriggers.length} triggers onto stack`);
    
  } catch (error) {
    console.error('[AI] Error ordering triggers:', error);
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
 * Execute pass priority for AI
 */
async function executePassPriority(
  io: Server,
  gameId: string,
  playerId: PlayerID
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  console.info('[AI] Passing priority:', { gameId, playerId });
  
  try {
    let resolvedNow = false;
    let advanceStep = false;
    
    // Use game's pass priority method if available
    if (typeof (game as any).passPriority === 'function') {
      const result = (game as any).passPriority(playerId);
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
      console.warn('[AI] Failed to persist passPriority event:', e);
    }
    
    // If all players passed priority in succession, resolve the top of the stack
    if (resolvedNow) {
      console.info('[AI] All players passed priority, resolving top of stack');
      if (typeof (game as any).resolveTopOfStack === 'function') {
        (game as any).resolveTopOfStack();
        console.log(`[AI] Stack resolved for game ${gameId}`);
      }
      
      // Check for pending library search (from tutor spells)
      // For AI players, we auto-select the best card; for human players, emit the request
      await handlePendingLibrarySearchAfterResolution(io, game, gameId);
      
      // Persist the resolution event
      try {
        await appendEvent(gameId, (game as any).seq || 0, 'resolveTopOfStack', { playerId });
      } catch (e) {
        console.warn('[AI] Failed to persist resolveTopOfStack event:', e);
      }
    }
    
    // If all players passed priority with empty stack, advance to next step
    // BUT: Do NOT advance if there are pending modals (e.g., library searches, color choices, creature type selections, Join Forces)
    // Human players need time to complete their modal interactions
    if (advanceStep) {
      const pendingCheck = checkPendingModals(game, gameId);
      if (pendingCheck.hasPending) {
        console.info(`[AI] Cannot advance step - ${pendingCheck.reason}`);
      } else {
        console.info('[AI] All players passed priority with empty stack, advancing step');
        if (typeof (game as any).nextStep === 'function') {
          (game as any).nextStep();
          console.log(`[AI] Advanced to next step for game ${gameId}`);
        }
        
        // Persist the step advance event
        try {
          await appendEvent(gameId, (game as any).seq || 0, 'nextStep', { playerId, reason: 'allPlayersPassed' });
        } catch (e) {
          console.warn('[AI] Failed to persist nextStep event:', e);
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
        handleAIPriority(io, gameId, nextPriority).catch(console.error);
      }, AI_REACTION_DELAY_MS);
    }
    
  } catch (error) {
    console.error('[AI] Error passing priority:', error);
  }
}

/**
 * Execute declare attackers for AI
 */
async function executeDeclareAttackers(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  attackerIds: string[]
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) return;
  
  console.info('[AI] Declaring attackers:', { gameId, playerId, attackerIds });
  
  try {
    if (typeof (game as any).declareAttackers === 'function') {
      (game as any).declareAttackers(playerId, attackerIds);
    }
    
    await appendEvent(gameId, (game as any).seq || 0, 'declareAttackers', { playerId, attackerIds });
    broadcastGame(io, game, gameId);
    
    // After declaring attackers, pass priority to allow opponents to respond
    // (cast instants, activate abilities before moving to declare blockers)
    // The step will advance when all players pass priority in succession
    await executePassPriority(io, gameId, playerId);
    
  } catch (error) {
    console.error('[AI] Error declaring attackers:', error);
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
  
  console.info('[AI] Declaring blockers:', { gameId, playerId, blockers });
  
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
    console.error('[AI] Error declaring blockers:', error);
    await executePassPriority(io, gameId, playerId);
  }
}

/**
 * Handle AI mulligan decision
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
  
  console.info('[AI] AI making mulligan decision:', { gameId, playerId });
  
  try {
    const context: AIDecisionContext = {
      gameState: game.state as any,
      playerId,
      decisionType: AIDecisionType.MULLIGAN,
      options: [true, false],
    };
    
    const decision = await aiEngine.makeDecision(context);
    const keepHand = decision.action?.keep ?? true;
    
    console.info('[AI] Mulligan decision:', {
      gameId,
      playerId,
      keepHand,
      reasoning: decision.reasoning,
    });
    
    return keepHand;
    
  } catch (error) {
    console.error('[AI] Error making mulligan decision:', error);
    return true; // Default to keeping hand
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
      console.info('[Game] Creating game without AI:', { gameId, format, startingLife });
      
      // Create a NEW game using GameManager.createGame() which handles DB persistence
      let game = GameManager.getGame(gameId);
      if (!game) {
        try {
          game = GameManager.createGame({ id: gameId });
          console.info('[Game] Created new game via GameManager:', gameId);
        } catch (createErr: any) {
          // Game might already exist (race condition), try to get it again
          game = GameManager.getGame(gameId);
          if (!game) {
            console.error('[Game] Failed to create or get game:', createErr);
            socket.emit('error', { code: 'GAME_CREATE_FAILED', message: 'Failed to create game' });
            return;
          }
          console.info('[Game] Game was created by another request, reusing:', gameId);
        }
      }
      
      // Set format and starting life
      game.state = (game.state || {}) as any;
      (game.state as any).format = format || 'commander';
      (game.state as any).startingLife = startingLife || (format === 'commander' ? 40 : 20);
      
      console.info('[Game] Game created successfully:', { gameId, format: (game.state as any).format, startingLife: (game.state as any).startingLife });
    } catch (err) {
      console.error('[Game] Error creating game:', err);
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
      console.info('[AI] Creating game with AI:', { gameId, playerName, aiName, aiStrategy, aiDifficulty, hasText: !!aiDeckText });
      
      // Create a NEW game using GameManager.createGame() which handles DB persistence
      // This is critical - ensureGame() checks if the game exists in DB first,
      // which fails for NEW games. We must use createGame() for new games.
      let game = GameManager.getGame(gameId);
      if (!game) {
        try {
          game = GameManager.createGame({ id: gameId });
          console.info('[AI] Created new game via GameManager:', gameId);
        } catch (createErr: any) {
          // Game might already exist (race condition), try to get it again
          game = GameManager.getGame(gameId);
          if (!game) {
            console.error('[AI] Failed to create or get game:', createErr);
            socket.emit('error', { code: 'GAME_CREATE_FAILED', message: 'Failed to create game' });
            return;
          }
          console.info('[AI] Game was created by another request, reusing:', gameId);
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
          console.info('[AI] AI player joined game via game.join():', { aiPlayerId, aiPlayerName });
        } catch (err) {
          console.warn('[AI] game.join failed for AI, using fallback:', err);
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
          console.info('[AI] Using imported deck text:', { deckName: finalDeckName, entryCount: deckEntries.length });
        } catch (e) {
          console.warn('[AI] Failed to parse deck text:', e);
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
            console.info('[AI] Loading deck for AI:', { deckId: aiDeckId, deckName: deck.name, cardCount: deck.card_count });
          } else {
            deckLoadError = `Deck with ID "${aiDeckId}" not found or is empty`;
            console.warn('[AI] Deck not found:', { deckId: aiDeckId, error: deckLoadError });
          }
        } catch (e) {
          deckLoadError = `Failed to load deck "${aiDeckId}": ${e instanceof Error ? e.message : String(e)}`;
          console.error('[AI] Error loading deck for AI:', { deckId: aiDeckId, error: e });
        }
      }
      
      // Resolve deck entries if we have any
      if (deckEntries.length > 0) {
        const requestedNames = deckEntries.map((e: any) => e.name);
        let byName: Map<string, any> | null = null;
        
        try {
          byName = await fetchCardsByExactNamesBatch(requestedNames);
        } catch (e) {
          console.warn('[AI] Failed to fetch cards from Scryfall:', e);
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
            console.info('[AI] Deck imported via importDeckResolved for AI:', { 
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
              console.info('[AI] Persisted deckImportResolved event for AI:', { aiPlayerId, cardCount: resolvedCards.length });
            } catch (e) {
              console.warn('[AI] Failed to persist deckImportResolved event:', e);
            }
          } else {
            // Fallback: manually initialize zones (this may cause issues with shuffle/draw)
            console.warn('[AI] importDeckResolved not available, using fallback zone initialization');
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
          
          console.info('[AI] Deck resolved for AI:', { 
            aiPlayerId, 
            deckName: finalDeckName, 
            resolvedCount: resolvedCards.length,
            missingCount: missing.length,
          });
          
          if (missing.length > 0) {
            console.warn('[AI] Missing cards in AI deck:', missing.slice(0, 10));
          }
        } else {
          deckLoadError = `No cards could be resolved from deck "${finalDeckName}"`;
          console.warn('[AI] No cards resolved:', { error: deckLoadError });
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
        console.warn('[AI] Failed to persist AI join event:', e);
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
        console.info('[AI] Triggering auto-commander selection for AI:', { gameId, aiPlayerId });
        
        // Small delay to ensure state is propagated
        setTimeout(async () => {
          try {
            await handleAIGameFlow(io, gameId, aiPlayerId);
          } catch (e) {
            console.error('[AI] Error in AI game flow after deck load:', e);
          }
        }, AI_THINK_TIME_MS);
      }
      
    } catch (error) {
      console.error('[AI] Error creating game with AI:', error);
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
      console.info('[AI] Creating game with multiple AI opponents:', { 
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
          console.info('[AI] Created new game via GameManager:', gameId);
        } catch (createErr: any) {
          // Game might already exist (race condition), try to get it again
          game = GameManager.getGame(gameId);
          if (!game) {
            console.error('[AI] Failed to create or get game:', createErr);
            socket.emit('error', { code: 'GAME_CREATE_FAILED', message: 'Failed to create game' });
            return;
          }
          console.info('[AI] Game was created by another request, reusing:', gameId);
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
            console.info(`[AI] AI player joined game via game.join():`, { aiPlayerId, aiName });
          } catch (err) {
            console.warn(`[AI] game.join failed for ${aiName}, using fallback:`, err);
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
            console.info(`[AI] Using imported deck text for ${aiName}:`, { deckName: finalDeckName, entryCount: deckEntries.length });
          } catch (e) {
            console.warn(`[AI] Failed to parse deck text for ${aiName}:`, e);
          }
        }
        // Priority 2: Use deckId if provided (select mode)
        else if (aiConfig.deckId) {
          try {
            const deck = getDeck(aiConfig.deckId);
            if (deck && deck.entries && deck.entries.length > 0) {
              deckEntries = deck.entries;
              finalDeckName = deck.name;
              console.info(`[AI] Loading deck for ${aiName}:`, { deckId: aiConfig.deckId, deckName: deck.name });
            } else {
              console.warn(`[AI] Deck not found for ${aiName}:`, { deckId: aiConfig.deckId });
            }
          } catch (e) {
            console.error(`[AI] Error loading deck for ${aiName}:`, { deckId: aiConfig.deckId, error: e });
          }
        }
        
        // Resolve deck entries if we have any
        if (deckEntries.length > 0) {
          const requestedNames = deckEntries.map((e: any) => e.name);
          let byName: Map<string, any> | null = null;
          
          try {
            byName = await fetchCardsByExactNamesBatch(requestedNames);
          } catch (e) {
            console.warn(`[AI] Failed to fetch cards from Scryfall for ${aiName}:`, e);
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
              console.info(`[AI] Deck imported for ${aiName}:`, { 
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
                console.info(`[AI] Persisted deckImportResolved event for ${aiName}:`, { aiPlayerId, cardCount: resolvedCards.length });
              } catch (e) {
                console.warn(`[AI] Failed to persist deckImportResolved event for ${aiName}:`, e);
              }
            } else {
              console.warn(`[AI] importDeckResolved not available for ${aiName}, using fallback`);
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
          console.warn(`[AI] Failed to persist AI join event for ${aiName}:`, e);
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
          console.info('[AI] Triggering auto-commander selection for:', { gameId, aiPlayerId: aiPlayer.playerId });
          
          setTimeout(async () => {
            try {
              await handleAIGameFlow(io, gameId, aiPlayer.playerId);
            } catch (e) {
              console.error(`[AI] Error in AI game flow for ${aiPlayer.name}:`, e);
            }
          }, AI_THINK_TIME_MS * (index + 1)); // Stagger delays
        }
      });
      
    } catch (error) {
      console.error('[AI] Error creating game with multiple AI opponents:', error);
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
      console.error('[AI] Error adding AI to game:', error);
      socket.emit('error', { code: 'AI_ADD_FAILED', message: 'Failed to add AI opponent' });
    }
  });
  
  // List available decks for AI
  socket.on('listDecksForAI', () => {
    try {
      const decks = listDecks();
      socket.emit('decksForAI', { decks });
    } catch (error) {
      console.error('[AI] Error listing decks for AI:', error);
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
      console.error('[AI] Error removing AI from game:', error);
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
        
        console.info('[AI] AI control enabled for player:', { gameId, playerId, strategy: aiStrategy, difficulty: aiDifficulty });
        
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
        
        console.info('[AI] AI control disabled for player:', { gameId, playerId });
        
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
      console.error('[AI] Error toggling AI control:', error);
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
    console.info('[AI] Cleaned up AI players for game:', gameId);
  }
}

/**
 * Check if there are any pending library searches for a game
 */
function hasPendingLibrarySearch(game: any): boolean {
  const pending = (game.state as any)?.pendingLibrarySearch;
  return pending && typeof pending === 'object' && Object.keys(pending).length > 0;
}

/**
 * Check if there are any pending modals that should block AI advancement.
 * Returns an object with a boolean flag and optional reason string.
 */
function checkPendingModals(game: any, gameId: string): { hasPending: boolean; reason?: string } {
  if (hasPendingLibrarySearch(game)) {
    return { hasPending: true, reason: 'players have pending library searches' };
  }
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
async function handlePendingLibrarySearchAfterResolution(
  io: Server,
  game: any,
  gameId: string
): Promise<void> {
  try {
    const pending = game.state?.pendingLibrarySearch;
    if (!pending || typeof pending !== 'object') return;
    
    for (const [playerId, searchInfo] of Object.entries(pending)) {
      if (!searchInfo) continue;
      
      const info = searchInfo as any;
      
      // Get the player's library for searching
      let library: any[] = [];
      if (typeof game.searchLibrary === 'function') {
        library = game.searchLibrary(playerId, '', 1000);
      } else {
        library = (game.libraries?.get(playerId)) || [];
      }
      
      if (isAIPlayer(gameId, playerId)) {
        // AI player: auto-select the best card based on criteria
        console.log(`[AI] Auto-selecting card from library for tutor: ${info.source || 'tutor'}`);
        
        // Filter library based on search criteria
        let validCards = library;
        const searchFor = (info.searchFor || '').toLowerCase();
        
        if (searchFor.includes('creature')) {
          validCards = library.filter((c: any) => c.type_line?.toLowerCase().includes('creature'));
        } else if (searchFor.includes('planeswalker')) {
          validCards = library.filter((c: any) => c.type_line?.toLowerCase().includes('planeswalker'));
        } else if (searchFor.includes('instant')) {
          validCards = library.filter((c: any) => c.type_line?.toLowerCase().includes('instant'));
        } else if (searchFor.includes('sorcery')) {
          validCards = library.filter((c: any) => c.type_line?.toLowerCase().includes('sorcery'));
        } else if (searchFor.includes('artifact')) {
          validCards = library.filter((c: any) => c.type_line?.toLowerCase().includes('artifact'));
        } else if (searchFor.includes('enchantment')) {
          validCards = library.filter((c: any) => c.type_line?.toLowerCase().includes('enchantment'));
        } else if (searchFor.includes('land')) {
          validCards = library.filter((c: any) => c.type_line?.toLowerCase().includes('land'));
          if (searchFor.includes('basic')) {
            validCards = validCards.filter((c: any) => c.type_line?.toLowerCase().includes('basic'));
          }
        }
        
        if (validCards.length > 0) {
          // AI card selection heuristic:
          // 1. For lands (e.g., fetch lands): prefer cards that produce multiple colors
          // 2. For creatures: consider power/toughness and keywords
          // 3. For other cards: use CMC as proxy for card quality
          
          const isLandSearch = searchFor.includes('land');
          
          if (isLandSearch) {
            // For land searches, prefer duals and lands that produce more colors
            validCards.sort((a: any, b: any) => {
              const aText = (a.oracle_text || '').toLowerCase();
              const bText = (b.oracle_text || '').toLowerCase();
              
              // Count number of mana symbols in oracle text
              const aManaTypes = (aText.match(/add \{[wubrgc]\}/gi) || []).length;
              const bManaTypes = (bText.match(/add \{[wubrgc]\}/gi) || []).length;
              
              // Prefer multi-color producing lands
              if (aManaTypes !== bManaTypes) return bManaTypes - aManaTypes;
              
              // Prefer lands that don't enter tapped
              const aEntersTapped = aText.includes('enters the battlefield tapped');
              const bEntersTapped = bText.includes('enters the battlefield tapped');
              if (aEntersTapped !== bEntersTapped) return aEntersTapped ? 1 : -1;
              
              return 0;
            });
          } else {
            // For non-lands, prefer cards with higher CMC (generally more impactful)
            // but also consider power/toughness for creatures
            validCards.sort((a: any, b: any) => {
              const aCmc = a.cmc || 0;
              const bCmc = b.cmc || 0;
              
              // For creatures, factor in power+toughness
              const aTypeLine = (a.type_line || '').toLowerCase();
              const bTypeLine = (b.type_line || '').toLowerCase();
              
              if (aTypeLine.includes('creature') && bTypeLine.includes('creature')) {
                const aPower = parseInt(a.power || '0', 10);
                const aToughness = parseInt(a.toughness || '0', 10);
                const bPower = parseInt(b.power || '0', 10);
                const bToughness = parseInt(b.toughness || '0', 10);
                
                const aStats = aPower + aToughness + aCmc;
                const bStats = bPower + bToughness + bCmc;
                return bStats - aStats;
              }
              
              return bCmc - aCmc;
            });
          }
          
          // Select multiple cards if maxSelections allows (e.g., Collective Voyage)
          const maxSelections = info.maxSelections || 1;
          const selectedCards = validCards.slice(0, Math.min(maxSelections, validCards.length));
          const selectedCardIds = selectedCards.map((c: any) => c.id);
          
          // Apply the search effect
          if (typeof game.selectFromLibrary === 'function' && selectedCardIds.length > 0) {
            // Pass the destination parameter to selectFromLibrary
            const destination = info.destination || 'hand';
            game.selectFromLibrary(playerId, selectedCardIds, destination);
            
            // Shuffle library after search
            if (info.shuffleAfter && typeof game.shuffleLibrary === 'function') {
              game.shuffleLibrary(playerId);
            }
            
            const cardNames = selectedCards.map((c: any) => c.name || c.id).join(', ');
            console.log(`[AI] Selected ${selectedCards.length} card(s) from library: ${cardNames} (${info.source || 'tutor'})`);
          }
        } else {
          console.log(`[AI] No valid cards found in library for ${info.source || 'tutor'}`);
          
          // Even if no cards found, still shuffle if requested
          if (info.shuffleAfter && typeof game.shuffleLibrary === 'function') {
            game.shuffleLibrary(playerId);
          }
        }
        
        // Clear pending search for this AI player after processing
        delete game.state.pendingLibrarySearch[playerId];
      } else {
        // Human player: emit library search request
        // Do NOT clear pendingLibrarySearch[playerId] here - it will be cleared when the player responds
        const socketsByPlayer: Map<string, any> = game.participantSockets || new Map();
        const socket = socketsByPlayer.get(playerId);
        
        const searchRequest = {
          gameId,
          playerId,
          cards: library,
          title: info.source || 'Search',
          description: info.searchFor ? `Search for: ${info.searchFor}` : 'Search your library',
          filter: info.filter || {},
          maxSelections: info.maxSelections || 1,
          moveTo: info.destination || 'hand',
          shuffleAfter: info.shuffleAfter ?? true,
          optional: info.optional || false,
          tapped: info.tapped || false,
        };
        
        if (socket) {
          socket.emit("librarySearchRequest", searchRequest);
        } else {
          // Broadcast to the room
          io.to(gameId).emit("librarySearchRequest", searchRequest);
        }
        
        console.log(`[handlePendingLibrarySearch] Sent librarySearchRequest to ${playerId} for ${info.source || 'tutor'}`);
      }
    }
    
    // NOTE: Do NOT clear entire pendingLibrarySearch here.
    // AI player entries are cleared immediately after processing above.
    // Human player entries are cleared when they respond via librarySearchSelect/Cancel handlers.
    
  } catch (err) {
    console.warn('[handlePendingLibrarySearchAfterResolution] Error:', err);
  }
}
