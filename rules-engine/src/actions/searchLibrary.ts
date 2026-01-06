/**
 * actions/searchLibrary.ts
 * 
 * Search library action handler (Rule 701.23)
 * Allows a player to search their library for cards matching criteria.
 */

import type { GameState } from '../../../shared/src';
import type { EngineResult, ActionContext, BaseAction } from '../core/types';
import { RulesEngineEvent } from '../core/events';

export interface SearchCriteria {
  readonly cardType?: string;
  readonly cardTypes?: string[]; // For OR matching (e.g., Island OR Swamp)
  readonly name?: string;
  readonly color?: string;
  readonly manaValue?: number;
  readonly maxResults?: number;
  readonly description?: string;
}

export interface SearchLibraryAction extends BaseAction {
  readonly type: 'searchLibrary';
  readonly criteria?: SearchCriteria;
  readonly destination?: 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'top' | 'bottom';
  readonly tapped?: boolean;
  readonly shuffle?: boolean;
  readonly selectedCardIds?: string[];
  readonly failToFind?: boolean;
}

/**
 * Check if a card matches search criteria
 */
function matchesCriteria(card: any, criteria: SearchCriteria): boolean {
  // Handle OR matching for multiple card types (e.g., fetchlands)
  if (criteria.cardTypes && criteria.cardTypes.length > 0) {
    const typeLine = (card.type_line || card.type || '').toLowerCase();
    const matchesAnyType = criteria.cardTypes.some(type => 
      typeLine.includes(type.toLowerCase())
    );
    if (!matchesAnyType) {
      return false;
    }
  } else if (criteria.cardType) {
    const typeLine = (card.type_line || card.type || '').toLowerCase();
    if (!typeLine.includes(criteria.cardType.toLowerCase())) {
      return false;
    }
  }
  
  if (criteria.name && card.name !== criteria.name) {
    return false;
  }
  
  if (criteria.color) {
    const colors = card.colors || [];
    if (!colors.includes(criteria.color.toUpperCase())) {
      return false;
    }
  }
  
  if (criteria.manaValue !== undefined) {
    if ((card.cmc || 0) !== criteria.manaValue) {
      return false;
    }
  }
  
  return true;
}

/**
 * Shuffle an array in place using Fisher-Yates
 */
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Validate if search action is legal
 */
export function validateSearchLibrary(
  state: GameState,
  action: SearchLibraryAction
): { legal: boolean; reason?: string } {
  const player = state.players.find(p => p.id === action.playerId);
  
  if (!player) {
    return { legal: false, reason: 'Player not found' };
  }
  
  const library = player.library || [];
  if (library.length === 0 && !action.failToFind) {
    return { legal: false, reason: 'Library is empty' };
  }
  
  return { legal: true };
}

/**
 * Execute search library action
 */
export function executeSearchLibrary(
  gameId: string,
  action: SearchLibraryAction,
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
  
  // Handle fail to find (Rule 701.23b)
  if (action.failToFind) {
    // Just shuffle and return
    let library = shuffleArray([...(player.library || [])]);
    
    const updatedPlayers = state.players.map(p =>
      p.id === action.playerId
        ? { ...p, library }
        : p
    );
    
    context.emit({
      type: RulesEngineEvent.LIBRARY_SEARCHED,
      timestamp: Date.now(),
      gameId,
      data: { playerId: action.playerId, failedToFind: true },
    });
    
    context.emit({
      type: RulesEngineEvent.LIBRARY_SHUFFLED,
      timestamp: Date.now(),
      gameId,
      data: { playerId: action.playerId },
    });
    
    return {
      next: { ...state, players: updatedPlayers },
      log: [`${action.playerId} searched library and failed to find`],
    };
  }
  
  const criteria = action.criteria || {};
  let library = [...(player.library || [])];
  let hand = [...(player.hand || [])];
  let battlefield = [...(state.battlefield || [])]; // Use centralized battlefield
  let graveyard = [...(player.graveyard || [])];
  const logs: string[] = [];
  
  // Find matching cards
  const matchingCards = library.filter(card => matchesCriteria(card, criteria));
  const maxResults = criteria.maxResults || 1;
  
  // Get selected cards (either from action or auto-select first matches)
  let selectedIds: string[];
  if (action.selectedCardIds && action.selectedCardIds.length > 0) {
    selectedIds = action.selectedCardIds;
  } else {
    selectedIds = matchingCards.slice(0, maxResults).map((c: any) => c.id);
  }
  
  // Process each selected card
  for (const cardId of selectedIds) {
    const cardIndex = library.findIndex((c: any) => c.id === cardId);
    if (cardIndex === -1) continue;
    
    const [card] = library.splice(cardIndex, 1);
    const destination = action.destination || 'hand';
    
    switch (destination) {
      case 'battlefield': {
        const permanent = {
          id: `perm_${Date.now()}_${cardId}`,
          controller: action.playerId,
          owner: action.playerId,
          tapped: action.tapped || false,
          counters: {},
          card: { ...card, zone: 'battlefield' },
        };
        battlefield.push(permanent as any);
        logs.push(`Put ${card.name} onto the battlefield${action.tapped ? ' tapped' : ''}`);
        
        context.emit({
          type: RulesEngineEvent.CARD_PUT_ONTO_BATTLEFIELD,
          timestamp: Date.now(),
          gameId,
          data: { cardId, cardName: card.name, playerId: action.playerId, tapped: action.tapped },
        });
        break;
      }
      
      case 'graveyard':
        graveyard.push({ ...card, zone: 'graveyard' });
        logs.push(`Put ${card.name} into graveyard`);
        break;
        
      case 'top':
        library.unshift({ ...card, zone: 'library' });
        logs.push(`Put ${card.name} on top of library`);
        break;
        
      case 'bottom':
        library.push({ ...card, zone: 'library' });
        logs.push(`Put ${card.name} on bottom of library`);
        break;
        
      case 'hand':
      default:
        hand.push({ ...card, zone: 'hand' });
        logs.push(`Put ${card.name} into hand`);
        
        context.emit({
          type: RulesEngineEvent.CARD_PUT_INTO_HAND,
          timestamp: Date.now(),
          gameId,
          data: { cardId, cardName: card.name, playerId: action.playerId },
        });
        break;
    }
  }
  
  // Shuffle library after search (Rule 701.23c) unless specified otherwise
  if (action.shuffle !== false) {
    library = shuffleArray(library);
    logs.push('Shuffled library');
    
    context.emit({
      type: RulesEngineEvent.LIBRARY_SHUFFLED,
      timestamp: Date.now(),
      gameId,
      data: { playerId: action.playerId },
    });
  }
  
  // Update player zones
  const updatedPlayers = state.players.map(p =>
    p.id === action.playerId
      ? { ...p, library, hand, graveyard }  // Don't add battlefield to player
      : p
  );
  
  const nextState: GameState = {
    ...state,
    players: updatedPlayers,
    battlefield,  // Update centralized battlefield
  };
  
  context.emit({
    type: RulesEngineEvent.LIBRARY_SEARCHED,
    timestamp: Date.now(),
    gameId,
    data: {
      playerId: action.playerId,
      criteria,
      foundCount: selectedIds.length,
    },
  });
  
  return {
    next: nextState,
    log: [`${action.playerId} searched library`, ...logs],
  };
}
