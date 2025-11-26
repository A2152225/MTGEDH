/**
 * actions/gameSetup.ts
 * 
 * Game initialization and mulligan handling.
 * Covers Rule 103: Starting the Game.
 */

import type { GameState } from '../../../shared/src';
import type { EngineResult, ActionContext } from '../core/types';
import { RulesEngineEvent } from '../core/events';
import { GamePhase, GameStep } from './gamePhases';

/**
 * Initialize a new game
 */
export function initializeGame(
  gameId: string,
  players: Array<{ id: string; name: string; deckCards: any[] }>,
  context: ActionContext
): EngineResult<GameState> {
  const initialState: GameState = {
    id: gameId,
    format: 'commander',
    players: players.map((p, i) => ({
      id: p.id,
      name: p.name,
      seat: i,
      life: 40,
      library: [...p.deckCards],
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      commandZone: [],
      manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      commanderDamage: {},
      counters: { poison: 0 },
      mulliganCount: 0,
    })) as any,
    startingLife: 40,
    life: {},
    turnPlayer: players[0]?.id || '',
    priority: players[0]?.id || '',
    stack: [],
    battlefield: [],
    commandZone: {},
    phase: GamePhase.PRE_GAME,
    step: GameStep.UNTAP, // Start at UNTAP; mulligan phase handled separately
    active: true,
    turnOrder: players.map(p => p.id),
    activePlayerIndex: 0,
    turn: 0,
    zones: {},
    landsPlayedThisTurn: {},
  } as any;
  
  context.setState(gameId, initialState);
  
  context.emit({
    type: RulesEngineEvent.GAME_STARTED,
    timestamp: Date.now(),
    gameId,
    data: { players: players.map(p => p.id) },
  });
  
  return {
    next: initialState,
    log: ['Game initialized', `${players.length} players joined`],
  };
}

/**
 * Draw initial hand (Rule 103.5: normally 7 cards)
 */
export function drawInitialHand(
  gameId: string,
  playerId: string,
  handSize: number,
  context: ActionContext
): EngineResult<GameState> {
  const state = context.getState(gameId);
  
  if (!state) {
    return {
      next: { players: [], stack: [], battlefield: [] } as unknown as GameState,
      log: ['Game not found'],
    };
  }
  
  const player = state.players.find(p => p.id === playerId);
  if (!player) {
    return { next: state, log: ['Player not found'] };
  }
  
  const library = [...(player.library || [])];
  const drawnCards = library.splice(0, handSize);
  
  const updatedPlayers = state.players.map(p =>
    p.id === playerId
      ? { ...p, library, hand: [...(p.hand || []), ...drawnCards] }
      : p
  );
  
  const nextState: GameState = { ...state, players: updatedPlayers };
  context.setState(gameId, nextState);
  
  return {
    next: nextState,
    log: [`${playerId} draws ${drawnCards.length} cards`],
  };
}

/**
 * Shuffle a player's library
 * Note: Uses Math.random() which is sufficient for casual play.
 * For competitive/tournament play, consider implementing a more
 * robust randomization method (e.g., server-side cryptographic RNG).
 */
function shuffleLibrary(library: any[]): any[] {
  const shuffled = [...library];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Process mulligan decision (Rule 103.6)
 */
export function processMulligan(
  gameId: string,
  playerId: string,
  keep: boolean,
  context: ActionContext
): EngineResult<GameState> {
  const state = context.getState(gameId);
  
  if (!state) {
    return {
      next: { players: [], stack: [], battlefield: [] } as unknown as GameState,
      log: ['Game not found'],
    };
  }
  
  const player = state.players.find(p => p.id === playerId);
  if (!player) {
    return { next: state, log: ['Player not found'] };
  }
  
  if (keep) {
    // Player keeps their hand
    const mulliganCount = (player as any).mulliganCount || 0;
    
    // In Commander, you put cards on bottom equal to mulligan count
    // For now, we'll handle the basic keep
    context.emit({
      type: RulesEngineEvent.MULLIGAN_COMPLETED,
      timestamp: Date.now(),
      gameId,
      data: { playerId, kept: true, mulliganCount },
    });
    
    return {
      next: state,
      log: [`${playerId} keeps hand`],
    };
  }
  
  // Mulligan: shuffle hand back, draw one fewer
  const library = shuffleLibrary([...(player.library || []), ...(player.hand || [])]);
  const mulliganCount = ((player as any).mulliganCount || 0) + 1;
  const newHandSize = Math.max(7 - mulliganCount, 0);
  const newHand = library.splice(0, newHandSize);
  
  const updatedPlayers = state.players.map(p =>
    p.id === playerId
      ? { ...p, library, hand: newHand, mulliganCount }
      : p
  );
  
  const nextState: GameState = { ...state, players: updatedPlayers as any };
  context.setState(gameId, nextState);
  
  context.emit({
    type: RulesEngineEvent.MULLIGAN_DECISION,
    timestamp: Date.now(),
    gameId,
    data: { playerId, kept: false, newHandSize, mulliganCount },
  });
  
  return {
    next: nextState,
    log: [`${playerId} mulligans to ${newHandSize} cards`],
  };
}

/**
 * Complete mulligan phase for all players
 */
export function completeMulliganPhase(
  gameId: string,
  context: ActionContext
): EngineResult<GameState> {
  const state = context.getState(gameId);
  
  if (!state) {
    return {
      next: { players: [], stack: [], battlefield: [] } as unknown as GameState,
      log: ['Game not found'],
    };
  }
  
  // Move to first turn
  const nextState: GameState = {
    ...state,
    phase: GamePhase.BEGINNING as any,
    step: GameStep.UNTAP as any,
    turn: 1,
  };
  
  context.setState(gameId, nextState);
  
  context.emit({
    type: RulesEngineEvent.TURN_STARTED,
    timestamp: Date.now(),
    gameId,
    data: { turn: 1, activePlayer: state.players[0]?.id },
  });
  
  return {
    next: nextState,
    log: ['Mulligan phase complete', 'Turn 1 begins'],
  };
}
