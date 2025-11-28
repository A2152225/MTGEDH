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
  
  // Use the shared types directly since gamePhases now re-exports them
  const currentPhase = state.phase || GamePhase.PRE_GAME;
  const currentStep = state.step || GameStep.UNTAP;
  
  // Get next step
  const { phase: nextPhase, step: nextStep, isNewTurn } = getNextGameStep(currentPhase, currentStep);
  
  let updatedState: GameState = {
    ...state,
    phase: nextPhase,
    step: nextStep,
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
      const resolvedState = resolveTopOfStack(gameId, state, context);
      
      // Reset priority to active player after resolution
      const activePlayerIndex = state.activePlayerIndex || 0;
      const finalState: GameState = {
        ...resolvedState.next,
        priorityPlayerIndex: activePlayerIndex,
        priorityPasses: 0,
      } as any;
      
      context.setState(gameId, finalState);
      
      return {
        next: finalState,
        log: [...(resolvedState.log || []), 'Priority reset to active player'],
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

/**
 * Resolve the top object on the stack
 * Rule 608: Resolving Spells and Abilities
 */
function resolveTopOfStack(
  gameId: string,
  state: GameState,
  context: ActionContext
): EngineResult<GameState> {
  const stack = state.stack || [];
  
  if (stack.length === 0) {
    return {
      next: state,
      log: ['Stack is empty, nothing to resolve'],
    };
  }
  
  // Pop the top object from the stack (LIFO)
  const topObject = stack[stack.length - 1];
  const newStack = stack.slice(0, -1);
  
  const logs: string[] = [];
  let updatedState: GameState = {
    ...state,
    stack: newStack,
  };
  
  // Resolve based on object type
  if (topObject.type === 'spell') {
    logs.push(`Resolving spell: ${topObject.cardName || topObject.name || 'Unknown spell'}`);
    
    // Check if all targets are still legal
    const targets = topObject.targets || [];
    let allTargetsLegal = true;
    
    for (const target of targets) {
      const targetId = typeof target === 'string' ? target : target.id;
      // Check if target still exists on battlefield
      const targetExists = (updatedState.battlefield || []).some(
        (p: any) => p.id === targetId
      ) || updatedState.players.some(p => p.id === targetId);
      
      if (!targetExists) {
        allTargetsLegal = false;
        break;
      }
    }
    
    if (!allTargetsLegal && targets.length > 0) {
      // Spell is countered by game rules (Rule 608.2b)
      logs.push(`${topObject.cardName || 'Spell'} countered - no legal targets`);
      
      // Move to graveyard
      const ownerId = topObject.controller || topObject.controllerId;
      updatedState = moveToGraveyard(updatedState, topObject, ownerId);
      
      context.emit({
        type: RulesEngineEvent.SPELL_COUNTERED,
        timestamp: Date.now(),
        gameId,
        data: { spell: topObject, reason: 'no legal targets' },
      });
    } else {
      // Spell resolves successfully
      logs.push(`${topObject.cardName || 'Spell'} resolves`);
      
      // Handle spell effects based on type
      const typeLine = (topObject.type_line || '').toLowerCase();
      const controllerId = topObject.controller || topObject.controllerId;
      
      if (typeLine.includes('creature') || typeLine.includes('artifact') || 
          typeLine.includes('enchantment') || typeLine.includes('planeswalker')) {
        // Permanent spell - enters the battlefield
        updatedState = enterBattlefield(updatedState, topObject, controllerId);
        logs.push(`${topObject.cardName || 'Permanent'} enters the battlefield`);
        
        context.emit({
          type: RulesEngineEvent.PERMANENT_ENTERED_BATTLEFIELD,
          timestamp: Date.now(),
          gameId,
          data: { permanent: topObject, controller: controllerId },
        });
      } else {
        // Instant/sorcery - goes to graveyard after resolution
        updatedState = moveToGraveyard(updatedState, topObject, controllerId);
        
        context.emit({
          type: RulesEngineEvent.SPELL_RESOLVED,
          timestamp: Date.now(),
          gameId,
          data: { spell: topObject },
        });
      }
    }
  } else if (topObject.type === 'ability') {
    logs.push(`Resolving ability: ${topObject.abilityText || topObject.name || 'triggered/activated ability'}`);
    
    // Abilities just cease to exist after resolving
    context.emit({
      type: RulesEngineEvent.ABILITY_RESOLVED,
      timestamp: Date.now(),
      gameId,
      data: { ability: topObject },
    });
  }
  
  context.setState(gameId, updatedState);
  
  return {
    next: updatedState,
    log: logs,
  };
}

/**
 * Move a card to its owner's graveyard
 */
function moveToGraveyard(state: GameState, card: any, ownerId: string): GameState {
  const updatedPlayers = state.players.map(player => {
    if (player.id === ownerId) {
      return {
        ...player,
        graveyard: [...(player.graveyard || []), card],
      };
    }
    return player;
  });
  
  return {
    ...state,
    players: updatedPlayers,
  };
}

/**
 * Put a permanent onto the battlefield
 */
function enterBattlefield(state: GameState, permanent: any, controllerId: string): GameState {
  const permanentOnBattlefield = {
    id: permanent.id || `perm-${Date.now()}`,
    card: permanent.card || permanent,
    controller: controllerId,
    controllerId,
    tapped: false,
    summoningSickness: true,
    counters: {},
    attachments: [],
  };
  
  // Add to both global battlefield and player's battlefield
  const updatedBattlefield = [...(state.battlefield || []), permanentOnBattlefield];
  
  const updatedPlayers = state.players.map(player => {
    if (player.id === controllerId) {
      return {
        ...player,
        battlefield: [...(player.battlefield || []), permanentOnBattlefield],
      };
    }
    return player;
  });
  
  return {
    ...state,
    battlefield: updatedBattlefield,
    players: updatedPlayers,
  };
}
