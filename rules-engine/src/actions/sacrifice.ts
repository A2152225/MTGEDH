/**
 * actions/sacrifice.ts
 * 
 * Sacrifice action handler (Rule 701.21)
 * Moves a permanent from battlefield to its owner's graveyard.
 */

import type { GameState } from '../../../shared/src';
import type { EngineResult, ActionContext, BaseAction } from '../core/types';
import { RulesEngineEvent } from '../core/events';

export interface SacrificeAction extends BaseAction {
  readonly type: 'sacrifice';
  readonly permanentId: string;
}

/**
 * Validate if sacrifice action is legal
 */
export function validateSacrifice(
  state: GameState,
  action: SacrificeAction
): { legal: boolean; reason?: string } {
  const player = state.players.find(p => p.id === action.playerId);
  
  if (!player) {
    return { legal: false, reason: 'Player not found' };
  }
  
  // Find permanent on centralized battlefield
  const permanent = (state.battlefield || []).find(
    (p: any) => p.id === action.permanentId && p.controller === action.playerId
  );
  
  if (!permanent) {
    return { legal: false, reason: 'Permanent not found on battlefield' };
  }
  
  // Check controller (Rule 701.21b)
  const controllerId = permanent.controllerId || permanent.controller || action.playerId;
  if (controllerId !== action.playerId) {
    return { legal: false, reason: 'Cannot sacrifice a permanent you do not control' };
  }
  
  return { legal: true };
}

/**
 * Execute sacrifice action
 */
export function executeSacrifice(
  gameId: string,
  action: SacrificeAction,
  context: ActionContext
): EngineResult<GameState> {
  const state = context.getState(gameId);
  
  if (!state) {
    // Return a minimal valid state to avoid type errors, with error logged
    return { 
      next: { players: [], stack: [], battlefield: [] } as unknown as GameState, 
      log: ['Game not found'] 
    };
  }
  
  const player = state.players.find(p => p.id === action.playerId);
  
  if (!player) {
    return { next: state, log: ['Player not found'] };
  }
  
  // Find and remove permanent from centralized battlefield
  const battlefield = [...(state.battlefield || [])];
  const permanentIndex = battlefield.findIndex(
    (p: any) => p.id === action.permanentId && p.controller === action.playerId
  );
  
  if (permanentIndex === -1) {
    return { next: state, log: ['Permanent not found on battlefield'] };
  }
  
  const [sacrificed] = battlefield.splice(permanentIndex, 1);
  
  // Add to graveyard
  const graveyard = [...(player.graveyard || []), { 
    ...sacrificed, 
    zone: 'graveyard',
    card: sacrificed.card ? { ...sacrificed.card, zone: 'graveyard' } : undefined
  }];
  
  // Update state with updated battlefield and player graveyard
  const updatedPlayers = state.players.map(p =>
    p.id === action.playerId
      ? { ...p, graveyard }
      : p
  );
  
  const nextState: GameState = {
    ...state,
    battlefield,
    players: updatedPlayers,
  };
  
  // Emit event
  const cardName = sacrificed?.name || sacrificed?.card?.name || 'permanent';
  context.emit({
    type: RulesEngineEvent.PERMANENT_SACRIFICED,
    timestamp: Date.now(),
    gameId,
    data: {
      permanentId: action.permanentId,
      playerId: action.playerId,
      cardName,
    },
  });
  
  return {
    next: nextState,
    log: [`Sacrificed ${cardName}`],
  };
}
