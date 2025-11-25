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

/** AI timing delays for more natural behavior */
const AI_THINK_TIME_MS = 500;
const AI_REACTION_DELAY_MS = 300;

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
 * Check if a card is a valid commander (legendary creature or has "can be your commander")
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
 * Find the best commander(s) from a deck's card list
 * Returns 1 or 2 commanders based on partner/background rules
 */
function findBestCommanders(cards: any[]): { commanders: any[]; colorIdentity: string[] } {
  // Find all valid commander candidates
  const candidates = cards.filter(isValidCommander);
  
  if (candidates.length === 0) {
    console.warn('[AI] No valid commander candidates found in deck');
    return { commanders: [], colorIdentity: [] };
  }
  
  // Find partner candidates
  const partnerCandidates = candidates.filter(hasPartner);
  const backgroundCandidates = cards.filter(c => (c.type_line || '').toLowerCase().includes('background'));
  const chooseBackgroundCandidates = candidates.filter(hasBackground);
  
  let selectedCommanders: any[] = [];
  
  // Check for partner pair
  if (partnerCandidates.length >= 2) {
    // Select first two partners
    selectedCommanders = partnerCandidates.slice(0, 2);
    console.info('[AI] Selected partner commanders:', selectedCommanders.map(c => c.name));
  }
  // Check for background pair
  else if (chooseBackgroundCandidates.length > 0 && backgroundCandidates.length > 0) {
    selectedCommanders = [chooseBackgroundCandidates[0], backgroundCandidates[0]];
    console.info('[AI] Selected commander + background:', selectedCommanders.map(c => c.name));
  }
  // Single commander
  else {
    selectedCommanders = [candidates[0]];
    console.info('[AI] Selected single commander:', selectedCommanders[0]?.name);
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
    const zones = game.state.zones?.[playerId] as any;
    const library = zones?.library || [];
    
    if (library.length === 0) {
      console.warn('[AI] autoSelectAICommander: no cards in library', { gameId, playerId });
      return false;
    }
    
    // Find the best commander(s) from the deck
    let { commanders, colorIdentity } = findBestCommanders(library);
    
    if (commanders.length === 0) {
      console.warn('[AI] autoSelectAICommander: no valid commander found', { gameId, playerId });
      // Fallback: just pick the first legendary card if any
      const legendary = library.find((c: any) => 
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
    
    // Call setCommander to set up the commander and trigger opening draw
    if (typeof (game as any).setCommander === 'function') {
      (game as any).setCommander(playerId, commanderNames, commanderIds, colorIdentity);
      
      // Verify the opening draw happened
      const zonesAfter = game.state.zones?.[playerId];
      const handCount = zonesAfter?.handCount ?? (Array.isArray(zonesAfter?.hand) ? zonesAfter.hand.length : 0);
      
      console.info('[AI] After setCommander - hand count:', handCount);
      
      // If hand is empty, manually trigger shuffle and draw
      if (handCount === 0) {
        console.info('[AI] Hand is empty after setCommander, manually triggering shuffle and draw');
        
        // Shuffle the library
        if (typeof (game as any).shuffleLibrary === 'function') {
          (game as any).shuffleLibrary(playerId);
          console.info('[AI] Library shuffled');
        }
        
        // Draw 7 cards
        if (typeof (game as any).drawCards === 'function') {
          const drawn = (game as any).drawCards(playerId, 7);
          console.info('[AI] Drew', drawn?.length || 0, 'cards');
        }
      }
      
      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, 'setCommander', {
          playerId,
          commanderNames,
          commanderIds,
          colorIdentity,
          isAI: true,
        });
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
  
  const phaseStr = String(game.state.phase || '').toUpperCase();
  const stepStr = String((game.state as any).step || '').toUpperCase();
  const commanderInfo = game.state.commandZone?.[playerId];
  const hasCommander = commanderInfo?.commanderIds?.length > 0;
  const zones = game.state.zones?.[playerId];
  const hasHand = (zones?.handCount || 0) > 0 || (zones?.hand?.length || 0) > 0;
  const isAITurn = game.state.turnPlayer === playerId;
  const hasPriority = game.state.priority === playerId;
  
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
    
    // If we have a commander and hand, we're ready to proceed
    if (hasCommander && hasHand) {
      console.info('[AI] AI is ready to start game');
      // AI is ready - if no turn player is set and AI should take initiative, we could start
      // But typically the human player starts the game
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
  
  return isMainPhase && isAITurn && landsPlayed < 1;
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
  
  const phase = String(game.state.phase || '').toLowerCase();
  const step = String((game.state as any).step || '').toLowerCase();
  const isAITurn = game.state.turnPlayer === playerId;
  const stackEmpty = !game.state.stack || game.state.stack.length === 0;
  
  console.info('[AI] AI player has priority:', { 
    gameId, 
    playerId, 
    phase, 
    step, 
    isAITurn, 
    stackEmpty,
    priority: game.state.priority 
  });
  
  try {
    // If it's not the AI's turn, just pass priority
    if (!isAITurn) {
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
    
    // CLEANUP STEP: Handle discard to max hand size
    if (step.includes('cleanup') || step === 'cleanup') {
      const { needsDiscard, discardCount } = needsToDiscard(game, playerId);
      
      if (needsDiscard) {
        console.info('[AI] Cleanup step - discarding', discardCount, 'cards');
        await executeAIDiscard(io, gameId, playerId, discardCount);
        return;
      }
      
      // Cleanup complete, advance to next turn
      console.info('[AI] Cleanup complete, advancing to next turn');
      await executeAdvanceStep(io, gameId, playerId);
      return;
    }
    
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
      
      // TODO: Try to cast spells (future enhancement)
      // For now, just advance step
      console.info('[AI] Main phase, no more actions, advancing step');
      await executeAdvanceStep(io, gameId, playerId);
      return;
    }
    
    // COMBAT PHASES: Handle attack/block declarations
    if (phase === 'combat') {
      if (step.includes('attackers') || step === 'declare_attackers') {
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
          // No attackers, advance step
          await executeAdvanceStep(io, gameId, playerId);
        }
        return;
      }
      
      if (step.includes('blockers') || step === 'declare_blockers') {
        const context: AIDecisionContext = {
          gameState: game.state as any,
          playerId,
          decisionType: AIDecisionType.DECLARE_BLOCKERS,
          options: [],
        };
        
        const decision = await aiEngine.makeDecision(context);
        
        if (decision.action?.blockers?.length > 0) {
          await executeDeclareBlockers(io, gameId, playerId, decision.action.blockers);
        } else {
          // No blockers, advance step
          await executeAdvanceStep(io, gameId, playerId);
        }
        return;
      }
      
      // Other combat steps - just advance
      console.info('[AI] Combat step', step, '- advancing');
      await executeAdvanceStep(io, gameId, playerId);
      return;
    }
    
    // BEGINNING PHASES (Untap, Upkeep, Draw)
    if (phase === 'beginning' || phase.includes('begin')) {
      console.info('[AI] Beginning phase, step:', step, '- advancing');
      await executeAdvanceStep(io, gameId, playerId);
      return;
    }
    
    // ENDING PHASE (End step)
    if (phase === 'ending' || phase === 'end') {
      console.info('[AI] Ending phase, step:', step, '- advancing');
      await executeAdvanceStep(io, gameId, playerId);
      return;
    }
    
    // Default: advance step
    console.info('[AI] Unknown phase/step, advancing');
    await executeAdvanceStep(io, gameId, playerId);
    
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
    // Use game's playLand method if available
    if (typeof (game as any).playLand === 'function') {
      (game as any).playLand(playerId, cardId);
    } else {
      // Fallback: manually move card from hand to battlefield
      const zones = game.state?.zones?.[playerId];
      if (zones && Array.isArray(zones.hand)) {
        const hand = zones.hand as any[];
        const idx = hand.findIndex((c: any) => c?.id === cardId);
        if (idx !== -1) {
          const [card] = hand.splice(idx, 1);
          zones.handCount = hand.length;
          
          // Add to battlefield
          game.state.battlefield = game.state.battlefield || [];
          const permanent = {
            id: `perm_${Date.now()}_${cardId}`,
            controller: playerId,
            owner: playerId,
            card: { ...card, zone: 'battlefield' },
            tapped: false,
            counters: {},
          };
          game.state.battlefield.push(permanent as any);
          
          // Increment lands played
          game.state.landsPlayedThisTurn = game.state.landsPlayedThisTurn || {};
          (game.state.landsPlayedThisTurn as any)[playerId] = ((game.state.landsPlayedThisTurn as any)[playerId] || 0) + 1;
        }
      }
    }
    
    // Persist event
    try {
      await appendEvent(gameId, (game as any).seq || 0, 'playLand', { playerId, cardId, isAI: true });
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
    
    // If AI still has priority after advancing, continue handling
    const newPriority = (game.state as any)?.priority;
    if (newPriority === playerId && isAIPlayer(gameId, playerId)) {
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
    // Use game's pass priority method if available
    if (typeof (game as any).passPriority === 'function') {
      (game as any).passPriority(playerId);
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
  // Create game with AI opponent
  socket.on('createGameWithAI', async ({
    gameId,
    playerName,
    format,
    startingLife,
    aiName,
    aiStrategy,
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
    aiDeckId?: string;
    aiDeckText?: string;
    aiDeckName?: string;
  }) => {
    try {
      console.info('[AI] Creating game with AI:', { gameId, playerName, aiName, aiStrategy, hasText: !!aiDeckText });
      
      // Ensure game exists
      const game = ensureGame(gameId);
      if (!game) {
        socket.emit('error', { code: 'GAME_NOT_FOUND', message: 'Failed to create game' });
        return;
      }
      
      // Set format and starting life
      game.state = game.state || {};
      (game.state as any).format = format || 'commander';
      (game.state as any).startingLife = startingLife || (format === 'commander' ? 40 : 20);
      
      // Create AI player
      const aiPlayerId = `ai_${Date.now().toString(36)}`;
      const strategy = (aiStrategy as AIStrategy) || AIStrategy.BASIC;
      
      // Add AI to game state with deck info
      game.state.players = game.state.players || [];
      const aiPlayer: any = {
        id: aiPlayerId,
        name: aiName || 'AI Opponent',
        life: (game.state as any).startingLife,
        isAI: true,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
      };
      
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
                zone: 'library',
              });
            }
          }
        }
        
        if (resolvedCards.length > 0) {
          // Shuffle the library
          for (let i = resolvedCards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [resolvedCards[i], resolvedCards[j]] = [resolvedCards[j], resolvedCards[i]];
          }
          
          aiPlayer.library = resolvedCards;
          aiPlayer.deckName = finalDeckName;
          // Use provided deckId or generate one for imported text
          aiPlayer.deckId = aiDeckId || (aiDeckText ? `imported_${Date.now().toString(36)}` : null);
          deckLoaded = true;
          
          // Initialize zones for AI
          game.state.zones = game.state.zones || {};
          (game.state.zones as any)[aiPlayerId] = {
            hand: [],
            handCount: 0,
            library: resolvedCards,
            libraryCount: resolvedCards.length,
            graveyard: [],
            graveyardCount: 0,
          };
          
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
      
      game.state.players.push(aiPlayer);
      
      // Register with AI engine
      registerAIPlayer(gameId, aiPlayerId, aiName || 'AI Opponent', strategy);
      
      // Persist AI join event
      try {
        await appendEvent(gameId, (game as any).seq || 0, 'aiJoin', {
          playerId: aiPlayerId,
          name: aiName || 'AI Opponent',
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
  
  // Add AI to existing game
  socket.on('addAIToGame', async ({
    gameId,
    aiName,
    aiStrategy,
    aiDeckId,
  }: {
    gameId: string;
    aiName?: string;
    aiStrategy?: string;
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
      
      // Add AI to game state
      game.state = game.state || {};
      game.state.players = game.state.players || [];
      game.state.players.push({
        id: aiPlayerId,
        name: aiName || 'AI Opponent',
        life: (game.state as any).startingLife || 40,
        isAI: true,
      } as any);
      
      // Register with AI engine
      registerAIPlayer(gameId, aiPlayerId, aiName || 'AI Opponent', strategy);
      
      socket.emit('aiPlayerCreated', { gameId, aiPlayerId, aiName: aiName || 'AI Opponent', strategy });
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
