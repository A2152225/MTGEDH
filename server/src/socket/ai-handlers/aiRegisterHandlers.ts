/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: registerAIHandlers socket.on bodies (createGame, addAI,
 * toggle AI control, deck load, strategies). Parent keeps a real exported
 * wrapper so existing `from "./ai.js"` callers keep working.
 *
 * Public entry symbols: registerAIHandlers.
 */
import { randomBytes } from "crypto";
import type { Server, Socket } from "socket.io";
import { AIStrategy } from "../../../../rules-engine/src/AIEngine.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { appendEvent, isGameCreator } from "../../db/index.js";
import { getDeck, listDecks } from "../../db/decks.js";
import { parseDecklist } from "../../services/scryfall.js";
import { resolveDeckList } from "../../services/deckImport.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { broadcastGame, ensureGame } from "../util.js";
import { addAIOpponentToExistingGame } from "./aiAddOpponentToGame.js";
import { removeAIOpponentFromExistingGame } from "./aiRemoveOpponentFromGame.js";
import { AI_FAST_CONTINUE_MS, AI_THINK_TIME_MS } from "./aiConstants.js";
import { handleAIGameFlow } from "./aiGameFlowHandlers.js";
import { createConfiguredGame } from "./aiGameSetupHandlers.js";
import { persistAIPlayerDeckSource, resolveAIDeckEntries } from "./aiPregameHandlers.js";
import { clearHumanAutopilotSeat, registerAIPlayer, unregisterAIPlayer } from "./aiPlayerRegistry.js";
import { joinAiPlayerSeat } from "../join-handlers/playerSeatIds.js";
import {
  aiPlayers,
  scheduleAIPriority,
} from "./aiScheduler.js";

/**
 * Register socket handlers for AI management
 */
export function registerAIHandlers(io: Server, socket: Socket): void {
  // Create game without AI (human players only)
  socket.on('createGame', async (payload?: {
    gameId?: unknown;
    format?: unknown;
    startingLife?: unknown;
    seed?: unknown;
  }) => {
    const gameId = payload?.gameId;
    const format = payload?.format;
    const startingLife = payload?.startingLife;
    const seed = payload?.seed;

    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit('error', { code: 'GAME_CREATE_FAILED', message: 'Invalid game creation payload' });
        return;
      }
      debug(1, '[Game] Creating game without AI:', { gameId, format, startingLife, seed });

      const { game, selectedFormat, selectedStartingLife, selectedSeed } = await createConfiguredGame(
        gameId,
        format,
        startingLife,
        seed,
        '[Game]',
      );

      debug(1, '[Game] Game created successfully:', {
        gameId,
        format: selectedFormat,
        startingLife: selectedStartingLife,
        seed: selectedSeed ?? (game.state as any).rngSeed,
      });
    } catch (err) {
      if ((err as any)?.code === 'GAME_ALREADY_EXISTS') {
        socket.emit('error', {
          code: 'GAME_ALREADY_EXISTS',
          message: 'Game already exists.',
        });
        return;
      }
      debugError(1, '[Game] Error creating game:', err);
      socket.emit('error', { 
        code: 'GAME_CREATE_FAILED', 
        message: err instanceof Error ? err.message : 'Failed to create game' 
      });
    }
  });

  // Create game with AI opponent
  socket.on('createGameWithAI', async (payload?: {
    gameId?: unknown;
    playerName?: unknown;
    format?: unknown;
    startingLife?: unknown;
    seed?: unknown;
    aiName?: unknown;
    aiStrategy?: unknown;
    aiDifficulty?: unknown;
    aiDeckId?: unknown;
    aiDeckText?: unknown;
    aiDeckName?: unknown;
  }) => {
    const gameId = payload?.gameId;
    const playerName = payload?.playerName;
    const format = payload?.format;
    const startingLife = payload?.startingLife;
    const seed = payload?.seed;
    const aiName = payload?.aiName;
    const aiStrategy = payload?.aiStrategy;
    const aiDifficulty = payload?.aiDifficulty;
    const aiDeckId = payload?.aiDeckId;
    const aiDeckText = payload?.aiDeckText;
    const aiDeckName = payload?.aiDeckName;

    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit('error', { code: 'GAME_CREATE_FAILED', message: 'Invalid game creation payload' });
        return;
      }
      debug(1, '[AI] Creating game with AI:', { gameId, playerName, aiName, aiStrategy, aiDifficulty, hasText: !!aiDeckText, seed });

      const { game } = await createConfiguredGame(
        gameId,
        format,
        startingLife,
        seed,
        '[AI]',
      );
      
      // Join the AI player to the game first
      // This will generate a playerId and properly initialize the player
      const difficulty = typeof aiDifficulty === 'number' ? aiDifficulty : 0.5; // Default to medium difficulty
      const aiPlayerName = typeof aiName === 'string' && aiName.trim() ? aiName : 'AI Opponent';
      const joinedAi = joinAiPlayerSeat(game, aiPlayerName);
      const aiPlayerId = joinedAi.playerId;
      debug(1, '[AI] AI player joined game via game.join():', { aiPlayerId, aiPlayerName });
      
      // Mark the player as AI in the game state and save strategy/difficulty for replay
      game.state.players = game.state.players || [];
      const playerInState = game.state.players.find((p: any) => p.id === aiPlayerId);
      if (playerInState) {
        playerInState.isAI = true;
        playerInState.difficulty = difficulty;
      }
      
      // Load deck for AI - either from saved deck ID or from imported text
      let deckLoaded = false;
      let deckLoadError: string | undefined;
      let deckEntries: Array<{ name: string; count: number }> = [];
      let finalDeckName: string | undefined;
      const importedDeckId = typeof aiDeckText === 'string' && aiDeckText.trim()
        ? `imported_${Date.now().toString(36)}`
        : null;
      
      // Priority 1: Use aiDeckText if provided (import mode)
      if (typeof aiDeckText === 'string' && aiDeckText.trim()) {
        try {
          deckEntries = parseDecklist(aiDeckText);
          finalDeckName = (typeof aiDeckName === 'string' && aiDeckName.trim()) ? aiDeckName : 'Imported Deck';
          debug(1, '[AI] Using imported deck text:', { deckName: finalDeckName, entryCount: deckEntries.length });
        } catch (e) {
          debugWarn(1, '[AI] Failed to parse deck text:', e);
          deckLoadError = 'Failed to parse deck text';
        }
      }
      // Priority 2: Use aiDeckId if provided (select mode)
      else if (typeof aiDeckId === 'string' && aiDeckId.trim()) {
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

      persistAIPlayerDeckSource(playerInState, {
        deckName: finalDeckName,
        deckId: (typeof aiDeckId === 'string' && aiDeckId.trim()) ? aiDeckId.trim() : importedDeckId,
        deckText: typeof aiDeckText === 'string' ? aiDeckText : undefined,
      });
      
      // Resolve deck entries if we have any
      if (deckEntries.length > 0) {
        let resolution: Awaited<ReturnType<typeof resolveDeckList>>;
        try {
          resolution = await resolveAIDeckEntries(deckEntries, {
            gameId,
            playerId: aiPlayerId as any,
            deckName: finalDeckName,
            logPrefix: '[AI] Loading AI deck',
          });
        } catch (e) {
          debugWarn(1, '[AI] Failed to resolve AI deck:', e);
          resolution = {
            resolvedCards: [],
            validationCards: [],
            missing: deckEntries.map((entry) => entry.name),
            usedLocalFallback: false,
            usedLocalIndex: false,
            sourcesUsed: [],
            scryfallTimedOut: false,
          };
        }
        const resolvedCards = resolution.resolvedCards;
        const missing = resolution.missing;
        
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
      const strategy = registerAIPlayer(gameId, aiPlayerId, aiPlayerName, difficulty);
      
      // Persist AI join event as a regular 'join' event so it can be properly replayed after server restart
      // Include isAI flag and seatToken from the join result
      try {
        const seatToken = joinedAi.seatToken || `ai_token_${randomBytes(6).toString('hex')}`;
        await appendEvent(gameId, (game as any).seq || 0, 'join', {
          playerId: aiPlayerId,
          name: aiPlayerName,
          seatToken,
          spectator: false,
          isAI: true,
          strategy,
          deckId: playerInState?.deckId || aiDeckId,
          deckName: playerInState?.deckName,
          deckText: playerInState?.deckText,
          deckLoaded,
        });
      } catch (e) {
        debugWarn(1, '[AI] Failed to persist AI join event:', e);
      }
      
      // Emit success
      socket.emit('aiPlayerCreated', {
        gameId,
        aiPlayerId,
        aiName: aiPlayerName,
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
      if ((error as any)?.code === 'GAME_ALREADY_EXISTS') {
        socket.emit('error', {
          code: 'GAME_ALREADY_EXISTS',
          message: 'Game already exists.',
        });
        return;
      }
      debugError(1, '[AI] Error creating game with AI:', error);
      socket.emit('error', { code: 'AI_CREATE_FAILED', message: 'Failed to create AI opponent' });
    }
  });

  // Create game with multiple AI opponents
  socket.on('createGameWithMultipleAI', async (payload?: {
    gameId?: unknown;
    playerName?: unknown;
    format?: unknown;
    startingLife?: unknown;
    seed?: unknown;
    aiOpponents?: unknown;
  }) => {
    const gameId = payload?.gameId;
    const playerName = payload?.playerName;
    const format = payload?.format;
    const startingLife = payload?.startingLife;
    const seed = payload?.seed;
    const aiOpponentsRaw = payload?.aiOpponents;

    try {
      if (!gameId || typeof gameId !== 'string' || !Array.isArray(aiOpponentsRaw)) {
        socket.emit('error', { code: 'GAME_CREATE_FAILED', message: 'Invalid game creation payload' });
        return;
      }

      const aiOpponents = aiOpponentsRaw as Array<{
        name: string;
        strategy: string;
        difficulty?: number;
        deckId?: string;
        deckText?: string;
        deckName?: string;
      }>;

      debug(1, '[AI] Creating game with multiple AI opponents:', { 
        gameId, 
        playerName, 
        seed,
        aiCount: aiOpponents.length,
        aiNames: aiOpponents.map(ai => ai.name),
        aiDifficulties: aiOpponents.map(ai => ai.difficulty ?? 0.5),
      });

      const { game } = await createConfiguredGame(
        gameId,
        format,
        startingLife,
        seed,
        '[AI]',
      );
      game.state.players = game.state.players || [];
      
      const createdAIPlayers: Array<{ playerId: string; name: string; strategy: string; deckLoaded: boolean }> = [];
      
      // Create each AI opponent
      for (let i = 0; i < aiOpponents.length; i++) {
        const aiConfig = aiOpponents[i];
        const difficulty = aiConfig.difficulty ?? 0.5; // Default to medium difficulty
        const aiName = aiConfig.name || `AI Opponent ${i + 1}`;
        
        // Join the AI player to the game first
        // This will generate a playerId and properly initialize the player
        const joinedAi = joinAiPlayerSeat(game, aiName, `_${i}`);
        const aiPlayerId = joinedAi.playerId;
        debug(1, `[AI] AI player joined game via game.join():`, { aiPlayerId, aiName });
        
        // Mark the player as AI in the game state and save strategy/difficulty for replay
        const playerInState = game.state.players?.find((p: any) => p.id === aiPlayerId);
        if (playerInState) {
          playerInState.isAI = true;
          playerInState.difficulty = difficulty;
        }
        
        // Load deck for AI
        let deckLoaded = false;
        let deckEntries: Array<{ name: string; count: number }> = [];
        let finalDeckName: string | undefined;
        const importedDeckId = typeof aiConfig.deckText === 'string' && aiConfig.deckText.trim()
          ? `imported_${Date.now().toString(36)}_${i}`
          : null;
        
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

        persistAIPlayerDeckSource(playerInState, {
          deckName: finalDeckName,
          deckId: aiConfig.deckId || importedDeckId,
          deckText: aiConfig.deckText,
        });
        
        // Resolve deck entries if we have any
        if (deckEntries.length > 0) {
          let resolution: Awaited<ReturnType<typeof resolveDeckList>>;
          try {
            resolution = await resolveAIDeckEntries(deckEntries, {
              gameId,
              playerId: aiPlayerId as any,
              deckName: finalDeckName,
              logPrefix: `[AI] Loading deck for ${aiName}`,
            });
          } catch (e) {
            debugWarn(1, `[AI] Failed to resolve deck for ${aiName}:`, e);
            resolution = {
              resolvedCards: [],
              validationCards: [],
              missing: deckEntries.map((entry) => entry.name),
              usedLocalFallback: false,
              usedLocalIndex: false,
              sourcesUsed: [],
              scryfallTimedOut: false,
            };
          }
          const resolvedCards = resolution.resolvedCards;
          
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
          }
        }
        
        // Register with AI engine
        const strategy = registerAIPlayer(gameId, aiPlayerId, aiName, difficulty);
        
        createdAIPlayers.push({
          playerId: aiPlayerId,
          name: aiName,
          strategy,
          deckLoaded,
        });
        
        // Persist AI join event as a regular 'join' event so it can be properly replayed after server restart
        // Include isAI flag and seatToken from the join result
        try {
          const seatToken = joinedAi.seatToken || `ai_token_${randomBytes(6).toString('hex')}`;
          await appendEvent(gameId, (game as any).seq || 0, 'join', {
            playerId: aiPlayerId,
            name: aiName,
            seatToken,
            spectator: false,
            isAI: true,
            strategy,
            deckId: playerInState?.deckId || aiConfig.deckId,
            deckName: playerInState?.deckName,
            deckText: playerInState?.deckText,
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
      if ((error as any)?.code === 'GAME_ALREADY_EXISTS') {
        socket.emit('error', {
          code: 'GAME_ALREADY_EXISTS',
          message: 'Game already exists.',
        });
        return;
      }
      debugError(1, '[AI] Error creating game with multiple AI opponents:', error);
      socket.emit('error', { code: 'AI_CREATE_FAILED', message: 'Failed to create AI opponents' });
    }
  });
  
  // Add AI to existing game (pre-game only, before all hands are kept)
  socket.on('addAIToGame', async (payload?: {
    gameId?: unknown;
    aiName?: unknown;
    aiStrategy?: unknown;
    aiDifficulty?: unknown;
    aiDeckId?: unknown;
    aiDeckText?: unknown;
    aiDeckName?: unknown;
  }) => {
    const gameId = payload?.gameId;
    const aiName = payload?.aiName;
    const aiDifficulty = payload?.aiDifficulty;
    const aiDeckId = payload?.aiDeckId;
    const aiDeckText = payload?.aiDeckText;
    const aiDeckName = payload?.aiDeckName;

    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit('error', { code: 'AI_ADD_FAILED', message: 'Invalid AI add payload' });
        return;
      }
      const requesterId = socket.data?.playerId as PlayerID | undefined;
      const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
      if (!requesterId || socketIsSpectator) {
        socket.emit('error', {
          code: 'AI_NOT_AUTHORIZED',
          message: 'Only the game creator can add AI players.',
        });
        return;
      }

      if ((socket.data as any)?.gameId && (socket.data as any).gameId !== gameId) {
        socket.emit('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
        return;
      }

      if (!(socket as any)?.rooms?.has?.(gameId)) {
        socket.emit('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
        return;
      }

      if (!isGameCreator(gameId, requesterId)) {
        socket.emit('error', {
          code: 'AI_NOT_AUTHORIZED',
          message: 'Only the game creator can add AI players.',
        });
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
        return;
      }

      const players = ((game.state as any)?.players || []) as any[];
      const me = players.find((p: any) => p?.id === requesterId);
      if (!me || me?.spectator || me?.isSpectator) {
        socket.emit('error', {
          code: 'AI_NOT_AUTHORIZED',
          message: 'Only the game creator can add AI players.',
        });
        return;
      }

      const result = await addAIOpponentToExistingGame(io, game, gameId, {
        aiName,
        aiDifficulty,
        aiDeckId,
        aiDeckText,
        aiDeckName,
      });
      if (result.ok === false) {
        socket.emit('error', { code: result.code, message: result.message });
        return;
      }

      socket.emit('aiPlayerCreated', {
        gameId,
        aiPlayerId: result.aiPlayerId,
        aiName: result.aiName,
        strategy: result.strategy,
        difficulty: result.difficulty,
        deckLoaded: result.deckLoaded,
        deckName: result.deckName,
      });
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
  socket.on('removeAIFromGame', async (payload?: {
    gameId?: unknown;
    aiPlayerId?: unknown;
  }) => {
    const gameId = payload?.gameId;
    const aiPlayerId = payload?.aiPlayerId;

    try {
      if (!gameId || typeof gameId !== 'string' || !aiPlayerId || typeof aiPlayerId !== 'string') {
        socket.emit('error', { code: 'AI_REMOVE_FAILED', message: 'Invalid AI remove payload' });
        return;
      }
      const requesterId = socket.data?.playerId as PlayerID | undefined;
      const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
      if (!requesterId || socketIsSpectator) {
        socket.emit('error', {
          code: 'AI_NOT_AUTHORIZED',
          message: 'Only the game creator can remove AI players.',
        });
        return;
      }

      if ((socket.data as any)?.gameId && (socket.data as any).gameId !== gameId) {
        socket.emit('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
        return;
      }

      if (!(socket as any)?.rooms?.has?.(gameId)) {
        socket.emit('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
        return;
      }

      if (!isGameCreator(gameId, requesterId)) {
        socket.emit('error', {
          code: 'AI_NOT_AUTHORIZED',
          message: 'Only the game creator can remove AI players.',
        });
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
        return;
      }

      const players = ((game.state as any)?.players || []) as any[];
      const me = players.find((p: any) => p?.id === requesterId);
      if (!me || me?.spectator || me?.isSpectator) {
        socket.emit('error', {
          code: 'AI_NOT_AUTHORIZED',
          message: 'Only the game creator can remove AI players.',
        });
        return;
      }

      const result = await removeAIOpponentFromExistingGame(io, game, gameId, aiPlayerId);
      if (result.ok === false) {
        socket.emit('error', { code: result.code, message: result.message });
        return;
      }

      socket.emit('aiPlayerRemoved', { gameId, aiPlayerId: result.aiPlayerId, aiName: result.aiName });
      
    } catch (error) {
      debugError(1, '[AI] Error removing AI from game:', error);
      socket.emit('error', { code: 'AI_REMOVE_FAILED', message: 'Failed to remove AI opponent' });
    }
  });

  /**
   * Toggle AI control for a human player
   * Allows a player to enable/disable AI autopilot for their seat
   */
  socket.on('toggleAIControl', async (payload?: {
    gameId?: unknown;
    enable?: unknown;
    strategy?: unknown;
    difficulty?: unknown;
  }) => {
    const gameId = payload?.gameId;
    const enable = payload?.enable;
    const strategy = payload?.strategy;
    const difficulty = payload?.difficulty;

    try {
      if (!gameId || typeof gameId !== 'string' || typeof enable !== 'boolean') {
        socket.emit('error', { code: 'AI_TOGGLE_FAILED', message: 'Invalid AI toggle payload' });
        return;
      }
      const playerId = socket.data.playerId as PlayerID | undefined;
      const socketIsSpectator = !!(
        (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
      );
      if (!playerId || socketIsSpectator) {
        socket.emit('error', { code: 'NOT_PLAYER', message: 'Only players can toggle AI control' });
        return;
      }

      if ((socket.data as any)?.gameId && (socket.data as any).gameId !== gameId) {
        socket.emit('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
        return;
      }

      if (!(socket as any)?.rooms?.has?.(gameId)) {
        socket.emit('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
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

      if ((playerInGame as any)?.spectator || (playerInGame as any)?.isSpectator) {
        socket.emit('error', { code: 'NOT_PLAYER', message: 'Only players can toggle AI control' });
        return;
      }

      let derivedStrategy: AIStrategy | undefined;

      if (enable) {
        const aiDifficulty = typeof difficulty === 'number' ? difficulty : 0.5;
        derivedStrategy = registerAIPlayer(
          gameId,
          playerId,
          playerInGame.name || 'Player',
          aiDifficulty,
        );
        
        // Store AI control state on the player (cast to any for dynamic properties)
        (playerInGame as any).aiControlled = true;
        (playerInGame as any).aiStrategy = derivedStrategy;
        (playerInGame as any).aiDifficulty = aiDifficulty;
        
        debug(1, '[AI] AI control enabled for player:', {
          gameId,
          playerId,
          strategy: derivedStrategy,
          difficulty: aiDifficulty,
        });
        
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${playerInGame.name || 'Player'} enabled AI autopilot (deck-aware).`,
          ts: Date.now(),
        });
        
        // If it's this player's turn or they have priority, trigger AI action
        const hasPriority = game.state?.priority === playerId;
        if (hasPriority) {
          // Delay briefly to allow state to update
          scheduleAIPriority(io, gameId, playerId, AI_FAST_CONTINUE_MS);
        }
      } else {
        // Clear isAI before unregister so a broadcast in this same turn cannot
        // rehydrate the seat and keep taking actions.
        clearHumanAutopilotSeat(playerInGame);
        unregisterAIPlayer(gameId, playerId);
        
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
        strategy: enable ? derivedStrategy : undefined,
        difficulty: enable ? (typeof difficulty === 'number' ? difficulty : 0.5) : undefined,
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
