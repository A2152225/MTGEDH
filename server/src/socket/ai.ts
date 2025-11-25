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
    const zones = game.state.zones?.[playerId];
    const library = zones?.library || [];
    
    if (library.length === 0) {
      console.warn('[AI] autoSelectAICommander: no cards in library', { gameId, playerId });
      return false;
    }
    
    // Find the best commander(s) from the deck
    const { commanders, colorIdentity } = findBestCommanders(library);
    
    if (commanders.length === 0) {
      console.warn('[AI] autoSelectAICommander: no valid commander found', { gameId, playerId });
      return false;
    }
    
    // Set commander using the game's setCommander function
    const commanderNames = commanders.map(c => c.name);
    const commanderIds = commanders.map(c => c.id);
    
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
  const commanderInfo = game.state.commandZone?.[playerId];
  const hasCommander = commanderInfo?.commanderIds?.length > 0;
  const zones = game.state.zones?.[playerId];
  const hasHand = (zones?.handCount || 0) > 0 || (zones?.hand?.length || 0) > 0;
  
  console.info('[AI] handleAIGameFlow:', {
    gameId,
    playerId,
    phase: phaseStr,
    hasCommander,
    hasHand,
    handCount: zones?.handCount,
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
      // The human player will typically start the game
    }
    return;
  }
  
  // Active game phases: handle priority
  if (game.state.priority === playerId) {
    await handleAIPriority(io, gameId, playerId);
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
 * Handle AI turn when it's an AI player's priority
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
  
  console.info('[AI] AI player has priority:', { gameId, playerId, phase: game.state.phase, step: game.state.step });
  
  try {
    // Determine what type of decision is needed based on game state
    const phase = String(game.state.phase || '').toLowerCase();
    const step = String((game.state as any).step || '').toLowerCase();
    
    let decisionType: AIDecisionType;
    if (phase === 'combat' && step === 'declareattackers') {
      decisionType = AIDecisionType.DECLARE_ATTACKERS;
    } else if (phase === 'combat' && step === 'declareblockers') {
      decisionType = AIDecisionType.DECLARE_BLOCKERS;
    } else {
      // Default to pass priority
      decisionType = AIDecisionType.PASS_PRIORITY;
    }
    
    // Build decision context
    const context: AIDecisionContext = {
      gameState: game.state as any,
      playerId,
      decisionType,
      options: [],
    };
    
    // Make AI decision
    const decision = await aiEngine.makeDecision(context);
    
    console.info('[AI] AI decision:', {
      gameId,
      playerId,
      type: decision.type,
      action: decision.action,
      reasoning: decision.reasoning,
      confidence: decision.confidence,
    });
    
    // Execute the decision
    await executeAIDecision(io, gameId, playerId, decision);
    
  } catch (error) {
    console.error('[AI] Error handling AI priority:', error);
    // Fallback: pass priority
    try {
      await executePassPriority(io, gameId, playerId);
    } catch (e) {
      console.error('[AI] Failed to pass priority as fallback:', e);
    }
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
          game.state.zones[aiPlayerId] = {
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
