/**
 * actions/gameAdvance.ts
 * 
 * Game advancement - moving between phases and steps.
 * Orchestrates turn-based actions, triggers, and state-based actions.
 */

import type { GameState } from '../../../shared/src';
import type { EngineResult, ActionContext } from '../core/types';
import { RulesEngineEvent } from '../core/events';
import { GamePhase, GameStep, getNextGameStep } from './gamePhases';
import { executeTurnBasedAction } from './turnActions';
import { performStateBasedActions, checkWinConditions } from './stateBasedActionsHandler';

/**
 * Advance game to next step/phase
 */
export function advanceGame(
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
  
  const currentPhase = (state.phase as GamePhase) || GamePhase.PRE_GAME;
  const currentStep = (state.step as GameStep) || GameStep.SETUP;
  
  // Get next step
  const { phase: nextPhase, step: nextStep, isNewTurn } = getNextGameStep(currentPhase, currentStep);
  
  let updatedState: GameState = {
    ...state,
    phase: nextPhase as any,
    step: nextStep as any,
  };
  
  const logs: string[] = [`Advanced to ${nextPhase} - ${nextStep}`];
  
  // If new turn, advance active player
  if (isNewTurn) {
    const nextActiveIndex = ((state.activePlayerIndex || 0) + 1) % state.players.length;
    updatedState = {
      ...updatedState,
      activePlayerIndex: nextActiveIndex,
      turn: (state.turn || 0) + 1,
      landsPlayedThisTurn: {}, // Reset lands played
    };
    
    logs.push(`Turn ${updatedState.turn} - ${state.players[nextActiveIndex]?.name}`);
    
    context.emit({
      type: RulesEngineEvent.TURN_STARTED,
      timestamp: Date.now(),
      gameId,
      data: { 
        turn: updatedState.turn,
        activePlayer: state.players[nextActiveIndex]?.id,
      },
    });
  }
  
  // Update state before turn-based actions
  context.setState(gameId, updatedState);
  
  // Execute turn-based actions for the new step
  const tbaResult = executeTurnBasedAction(gameId, updatedState, context);
  updatedState = tbaResult.next;
  logs.push(...(tbaResult.log || []));
  
  // Check state-based actions
  const sbaResult = performStateBasedActions(updatedState);
  updatedState = sbaResult.state;
  logs.push(...sbaResult.actions);
  
  // Check win conditions
  const winCheck = checkWinConditions(updatedState);
  if (winCheck.winner) {
    logs.push(`${winCheck.winner} wins! ${winCheck.reason}`);
    context.emit({
      type: RulesEngineEvent.PLAYER_WON,
      timestamp: Date.now(),
      gameId,
      data: { winner: winCheck.winner, reason: winCheck.reason },
    });
  }
  
  context.emit({
    type: RulesEngineEvent.PHASE_STARTED,
    timestamp: Date.now(),
    gameId,
    data: { phase: nextPhase, step: nextStep },
  });
  
  // Update final state
  context.setState(gameId, updatedState);
  
  return {
    next: updatedState,
    log: logs,
  };
}

/**
 * Skip to specific phase (for testing/shortcuts)
 */
export function skipToPhase(
  gameId: string,
  targetPhase: GamePhase,
  targetStep: GameStep,
  context: ActionContext
): EngineResult<GameState> {
  const state = context.getState(gameId);
  
  if (!state) {
    return {
      next: { players: [], stack: [], battlefield: [] } as unknown as GameState,
      log: ['Game not found'],
    };
  }
  
  const updatedState: GameState = {
    ...state,
    phase: targetPhase as any,
    step: targetStep as any,
  };
  
  context.setState(gameId, updatedState);
  
  return {
    next: updatedState,
    log: [`Skipped to ${targetPhase} - ${targetStep}`],
  };
}

/**
 * Pass priority (all players pass = advance step/resolve stack)
 */
export function passPriority(
  gameId: string,
  playerId: string,
  context: ActionContext
): EngineResult<GameState> {
  const state = context.getState(gameId);
  
  if (!state) {
    return {
      next: { players: [], stack: [], battlefield: [] } as unknown as GameState,
      log: ['Game not found'],
    };
  }
  
  const currentPriorityIndex = state.priorityPlayerIndex || 0;
  const nextPriorityIndex = (currentPriorityIndex + 1) % state.players.length;
  
  // Track passes for this round of priority
  const priorityPasses = ((state as any).priorityPasses || 0) + 1;
  
  // If all players passed
  if (priorityPasses >= state.players.length) {
    // Check if stack is empty
    if ((state.stack || []).length === 0) {
      // Advance to next step
      return advanceGame(gameId, context);
    } else {
      // Resolve top of stack
      // TODO: Implement full stack resolution with resolveStackTop
      // For now, reset priority passes and continue
      // Stack resolution will be handled by existing resolveStack action
      return {
        next: { ...state, priorityPasses: 0 } as any,
        log: ['All players passed, ready to resolve stack'],
      };
    }
  }
  
  const updatedState: GameState = {
    ...state,
    priorityPlayerIndex: nextPriorityIndex,
    priorityPasses,
  } as any;
  
  context.setState(gameId, updatedState);
  
  context.emit({
    type: RulesEngineEvent.PRIORITY_PASSED,
    timestamp: Date.now(),
    gameId,
    data: { 
      from: playerId, 
      to: state.players[nextPriorityIndex]?.id,
    },
  });
  
  return {
    next: updatedState,
    log: [`${playerId} passes priority`],
  };
}
