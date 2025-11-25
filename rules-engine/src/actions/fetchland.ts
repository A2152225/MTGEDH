/**
 * actions/fetchland.ts
 * 
 * Fetch land ability handler.
 * Handles the complete sequence: tap, pay life (optional), sacrifice, search.
 */

import type { GameState } from '../../../shared/src';
import type { EngineResult, ActionContext, BaseAction } from '../core/types';
import { RulesEngineEvent } from '../core/events';
import { executeSacrifice, type SacrificeAction } from './sacrifice';
import { executeSearchLibrary, type SearchLibraryAction, type SearchCriteria } from './searchLibrary';

export interface FetchlandAction extends BaseAction {
  readonly type: 'activateFetchland';
  readonly sourceId: string;
  readonly payLife?: number;
  readonly searchCriteria?: SearchCriteria;
  readonly tapped?: boolean;
  readonly selectedCardIds?: string[];
}

/**
 * Validate fetchland activation
 */
export function validateFetchland(
  state: GameState,
  action: FetchlandAction
): { legal: boolean; reason?: string } {
  const player = state.players.find(p => p.id === action.playerId);
  
  if (!player) {
    return { legal: false, reason: 'Player not found' };
  }
  
  // Find the fetchland on battlefield
  const battlefield = player.battlefield || [];
  const fetchland = battlefield.find((p: any) => p.id === action.sourceId);
  
  if (!fetchland) {
    return { legal: false, reason: 'Fetchland not found on battlefield' };
  }
  
  // Check if already tapped
  if (fetchland.tapped) {
    return { legal: false, reason: 'Fetchland is already tapped' };
  }
  
  // Check if player can pay life
  if (action.payLife && (player.life || 0) < action.payLife) {
    return { legal: false, reason: 'Not enough life to pay activation cost' };
  }
  
  return { legal: true };
}

/**
 * Execute fetchland activation
 * This combines multiple atomic actions into a single ability resolution
 */
export function executeFetchland(
  gameId: string,
  action: FetchlandAction,
  context: ActionContext
): EngineResult<GameState> {
  let state = context.getState(gameId);
  
  if (!state) {
    return { next: state!, log: ['Game not found'] };
  }
  
  const logs: string[] = [];
  const player = state.players.find(p => p.id === action.playerId);
  
  if (!player) {
    return { next: state, log: ['Player not found'] };
  }
  
  // Step 1: Pay life (if required, like true fetchlands)
  if (action.payLife && action.payLife > 0) {
    const newLife = (player.life || 0) - action.payLife;
    
    state = {
      ...state,
      players: state.players.map(p =>
        p.id === action.playerId
          ? { ...p, life: newLife }
          : p
      ),
    };
    
    logs.push(`Paid ${action.payLife} life`);
    
    context.emit({
      type: RulesEngineEvent.LIFE_PAID,
      timestamp: Date.now(),
      gameId,
      data: { playerId: action.playerId, amount: action.payLife, newLife },
    });
    
    // Update context state
    context.setState(gameId, state);
  }
  
  // Step 2: Sacrifice the fetchland
  const sacrificeAction: SacrificeAction = {
    type: 'sacrifice',
    playerId: action.playerId,
    permanentId: action.sourceId,
  };
  
  const sacrificeResult = executeSacrifice(gameId, sacrificeAction, context);
  state = sacrificeResult.next;
  logs.push(...(sacrificeResult.log || []));
  context.setState(gameId, state);
  
  // Step 3: Search library for land
  const searchAction: SearchLibraryAction = {
    type: 'searchLibrary',
    playerId: action.playerId,
    criteria: action.searchCriteria || { cardType: 'basic land' },
    destination: 'battlefield',
    tapped: action.tapped ?? true, // Default: enters tapped (like Evolving Wilds)
    shuffle: true,
    selectedCardIds: action.selectedCardIds,
  };
  
  const searchResult = executeSearchLibrary(gameId, searchAction, context);
  state = searchResult.next;
  logs.push(...(searchResult.log || []));
  
  return {
    next: state,
    log: logs,
  };
}

/**
 * Create a fetchland activation action for common fetchlands
 */
export function createEvolvingWildsAction(
  playerId: string,
  sourceId: string,
  selectedCardId?: string
): FetchlandAction {
  return {
    type: 'activateFetchland',
    playerId,
    sourceId,
    payLife: 0,
    searchCriteria: { cardType: 'basic land', maxResults: 1 },
    tapped: true,
    selectedCardIds: selectedCardId ? [selectedCardId] : undefined,
  };
}

/**
 * Create a fetchland activation action for enemy fetchlands (e.g., Polluted Delta)
 */
export function createEnemyFetchlandAction(
  playerId: string,
  sourceId: string,
  landType1: string,
  landType2: string,
  selectedCardId?: string
): FetchlandAction {
  // For fetchlands like Polluted Delta (Island or Swamp)
  // The criteria should match lands with either type
  return {
    type: 'activateFetchland',
    playerId,
    sourceId,
    payLife: 1,
    searchCriteria: { 
      cardType: landType1, // This is simplified - real implementation needs OR logic
      maxResults: 1 
    },
    tapped: false, // True fetchlands enter untapped
    selectedCardIds: selectedCardId ? [selectedCardId] : undefined,
  };
}

/**
 * Create a fetchland activation action for allied fetchlands (e.g., Flooded Strand)
 */
export function createAlliedFetchlandAction(
  playerId: string,
  sourceId: string,
  landType1: string,
  landType2: string,
  selectedCardId?: string
): FetchlandAction {
  return {
    type: 'activateFetchland',
    playerId,
    sourceId,
    payLife: 1,
    searchCriteria: { 
      cardType: landType1, // Simplified - real implementation needs OR logic
      maxResults: 1 
    },
    tapped: false,
    selectedCardIds: selectedCardId ? [selectedCardId] : undefined,
  };
}
