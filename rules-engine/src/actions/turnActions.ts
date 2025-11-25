/**
 * actions/turnActions.ts
 * 
 * Turn-based actions that happen automatically at specific steps.
 * Rule 703: These don't use the stack.
 */

import type { GameState } from '../../../shared/src';
import type { EngineResult, ActionContext } from '../core/types';
import { RulesEngineEvent } from '../core/events';
import { GameStep } from './gamePhases';

/**
 * Execute turn-based action for untap step
 * Rule 703.4c: Active player untaps all their permanents
 */
export function executeUntapStep(
  state: GameState,
  activePlayerId: string
): { state: GameState; logs: string[] } {
  const logs: string[] = [];
  
  const updatedPlayers = state.players.map(p => {
    if (p.id !== activePlayerId) return p;
    
    const untappedCount = (p.battlefield || []).filter((perm: any) => perm.tapped).length;
    if (untappedCount > 0) {
      logs.push(`${activePlayerId} untaps ${untappedCount} permanents`);
    }
    
    return {
      ...p,
      battlefield: (p.battlefield || []).map((perm: any) => ({
        ...perm,
        tapped: false,
      })),
    };
  });
  
  return {
    state: { ...state, players: updatedPlayers },
    logs,
  };
}

/**
 * Execute turn-based action for draw step
 * Rule 703.4d: Active player draws a card
 */
export function executeDrawStep(
  state: GameState,
  activePlayerId: string,
  context: ActionContext,
  gameId: string
): { state: GameState; logs: string[] } {
  const logs: string[] = [];
  const player = state.players.find(p => p.id === activePlayerId);
  
  if (!player) {
    return { state, logs: ['Player not found'] };
  }
  
  const library = [...(player.library || [])];
  if (library.length === 0) {
    logs.push(`${activePlayerId} cannot draw (empty library)`);
    return { state, logs };
  }
  
  const [drawnCard] = library.splice(0, 1);
  logs.push(`${activePlayerId} draws a card`);
  
  const updatedPlayers = state.players.map(p =>
    p.id === activePlayerId
      ? { ...p, library, hand: [...(p.hand || []), drawnCard] }
      : p
  );
  
  context.emit({
    type: RulesEngineEvent.CARD_DRAWN,
    timestamp: Date.now(),
    gameId,
    data: { playerId: activePlayerId, cardId: drawnCard.id },
  });
  
  return {
    state: { ...state, players: updatedPlayers },
    logs,
  };
}

/**
 * Execute turn-based action for cleanup step
 * Rule 703.4n/p: Discard to hand size, remove damage
 */
export function executeCleanupStep(
  state: GameState,
  activePlayerId: string
): { state: GameState; logs: string[]; discardRequired: number } {
  const logs: string[] = [];
  const player = state.players.find(p => p.id === activePlayerId);
  
  if (!player) {
    return { state, logs: ['Player not found'], discardRequired: 0 };
  }
  
  // Check for discard requirement
  const maxHandSize = 7;
  const handSize = (player.hand || []).length;
  const discardRequired = Math.max(0, handSize - maxHandSize);
  
  if (discardRequired > 0) {
    logs.push(`${activePlayerId} must discard ${discardRequired} cards`);
  }
  
  // Remove damage from all permanents
  const updatedPlayers = state.players.map(p => ({
    ...p,
    battlefield: (p.battlefield || []).map((perm: any) => ({
      ...perm,
      counters: {
        ...perm.counters,
        damage: 0,
      },
    })),
  }));
  
  logs.push('Damage removed from all permanents');
  
  return {
    state: { ...state, players: updatedPlayers },
    logs,
    discardRequired,
  };
}

/**
 * Execute turn-based action for current step
 */
export function executeTurnBasedAction(
  gameId: string,
  state: GameState,
  context: ActionContext
): EngineResult<GameState> {
  const activePlayer = state.players[state.activePlayerIndex || 0];
  const step = state.step as GameStep;
  let currentState = state;
  const allLogs: string[] = [];
  
  switch (step) {
    case GameStep.UNTAP: {
      const result = executeUntapStep(currentState, activePlayer.id);
      currentState = result.state;
      allLogs.push(...result.logs);
      break;
    }
    
    case GameStep.DRAW: {
      const result = executeDrawStep(currentState, activePlayer.id, context, gameId);
      currentState = result.state;
      allLogs.push(...result.logs);
      break;
    }
    
    case GameStep.CLEANUP: {
      const result = executeCleanupStep(currentState, activePlayer.id);
      currentState = result.state;
      allLogs.push(...result.logs);
      break;
    }
    
    case GameStep.UPKEEP:
      allLogs.push('Upkeep step begins');
      break;
      
    case GameStep.MAIN:
      allLogs.push('Main phase');
      break;
      
    case GameStep.BEGINNING_OF_COMBAT:
      allLogs.push('Beginning of combat');
      break;
      
    case GameStep.END_STEP:
      allLogs.push('End step begins');
      break;
      
    default:
      allLogs.push(`Step: ${step}`);
  }
  
  context.emit({
    type: RulesEngineEvent.STEP_STARTED,
    timestamp: Date.now(),
    gameId,
    data: { step, phase: state.phase },
  });
  
  return { next: currentState, log: allLogs };
}
