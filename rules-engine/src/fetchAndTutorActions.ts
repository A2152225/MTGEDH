/**
 * Additional action handlers needed for fetch lands and tutors
 * 
 * These handlers integrate the search and sacrifice keyword actions
 * into the RulesEngineAdapter.
 */

import type { GameState } from '../../shared/src';
import type { EngineResult } from './index';
import { searchZone, completeSearch, type SearchAction, type SearchCriteria } from './keywordActions/search';
import { sacrificePermanent, canSacrifice } from './keywordActions/sacrifice';

/**
 * Example of what needs to be added to RulesEngineAdapter
 */

// In executeAction switch statement, add these cases:

/**
 * Search library for cards (tutors)
 */
function searchLibraryAction(gameId: string, action: any): EngineResult<GameState> {
  const state = this.gameStates.get(gameId)!;
  const player = state.players.find(p => p.id === action.playerId);
  
  if (!player) {
    return { next: state, log: ['Player not found'] };
  }
  
  // Create search criteria
  const criteria: SearchCriteria = {
    cardType: action.cardType,
    name: action.cardName,
    color: action.color,
    maxResults: action.maxResults,
  };
  
  // Perform search (in real implementation, this would show UI to player)
  // For now, simulate finding cards that match criteria
  const foundCards = player.library.filter(card => {
    if (criteria.cardType && !card.type_line?.includes(criteria.cardType)) {
      return false;
    }
    if (criteria.name && card.name !== criteria.name) {
      return false;
    }
    return true;
  }).slice(0, criteria.maxResults || 1);
  
  // Update game state based on what happens with found cards
  // (put in hand, put on battlefield, etc.)
  
  this.emit({
    type: RulesEngineEvent.LIBRARY_SEARCHED,
    timestamp: Date.now(),
    gameId,
    data: {
      playerId: action.playerId,
      criteria,
      foundCards: foundCards.length,
    },
  });
  
  return {
    next: state,
    log: [`${action.playerId} searched library`],
  };
}

/**
 * Sacrifice permanent (fetch lands)
 */
function sacrificePermanentAction(gameId: string, action: any): EngineResult<GameState> {
  const state = this.gameStates.get(gameId)!;
  const player = state.players.find(p => p.id === action.playerId);
  
  if (!player) {
    return { next: state, log: ['Player not found'] };
  }
  
  // Find the permanent on battlefield
  const permanent = player.battlefield.find(c => c.id === action.permanentId);
  
  // Validate can sacrifice
  if (!canSacrifice(permanent ? { id: permanent.id, controllerId: action.playerId } : null, action.playerId)) {
    return {
      next: state,
      log: ['Cannot sacrifice that permanent'],
    };
  }
  
  // Move from battlefield to graveyard
  const updatedBattlefield = player.battlefield.filter(c => c.id !== action.permanentId);
  const updatedGraveyard = [...player.graveyard, permanent!];
  
  const updatedPlayers = state.players.map(p =>
    p.id === action.playerId
      ? { ...p, battlefield: updatedBattlefield, graveyard: updatedGraveyard }
      : p
  );
  
  const nextState: GameState = {
    ...state,
    players: updatedPlayers,
  };
  
  this.emit({
    type: RulesEngineEvent.PERMANENT_SACRIFICED,
    timestamp: Date.now(),
    gameId,
    data: {
      permanentId: action.permanentId,
      playerId: action.playerId,
      cardName: permanent?.name,
    },
  });
  
  // Trigger any dies triggers
  // processEvent(TriggerEvent.DIES, this.triggeredAbilities.get(gameId)!, { permanentId: action.permanentId });
  
  return {
    next: nextState,
    log: [`Sacrificed ${permanent?.name}`],
  };
}

/**
 * Example: Evolving Wilds activation
 * 
 * {T}, Sacrifice Evolving Wilds: Search your library for a basic land card,
 * put it onto the battlefield tapped, then shuffle.
 */
function activateEvolvingWilds(gameId: string, action: any): EngineResult<GameState> {
  // 1. Tap the land (handled separately)
  
  // 2. Sacrifice Evolving Wilds
  const sacrificeResult = this.sacrificePermanentAction(gameId, {
    type: 'sacrifice',
    playerId: action.playerId,
    permanentId: action.sourceId,
  });
  
  if (!sacrificeResult.next) {
    return sacrificeResult;
  }
  
  // 3. Search library for basic land
  const searchResult = this.searchLibraryAction(gameId, {
    type: 'searchLibrary',
    playerId: action.playerId,
    cardType: 'Basic Land',
    maxResults: 1,
    putOnBattlefield: true,
    tapped: true,
  });
  
  // 4. Shuffle library (handled in search)
  
  return {
    next: searchResult.next,
    log: [
      ...(sacrificeResult.log || []),
      ...(searchResult.log || []),
    ],
  };
}

/**
 * Example: Fetchland activation
 * 
 * {T}, Pay 1 life, Sacrifice [Fetchland]: Search your library for a [land type] card,
 * put it onto the battlefield, then shuffle.
 */
function activateFetchland(gameId: string, action: any): EngineResult<GameState> {
  const state = this.gameStates.get(gameId)!;
  const player = state.players.find(p => p.id === action.playerId);
  
  if (!player) {
    return { next: state, log: ['Player not found'] };
  }
  
  // 1. Pay 1 life
  const updatedPlayers = state.players.map(p =>
    p.id === action.playerId
      ? { ...p, life: p.life - 1 }
      : p
  );
  
  let nextState: GameState = {
    ...state,
    players: updatedPlayers,
  };
  
  // 2. Sacrifice the fetchland
  const sacrificeResult = this.sacrificePermanentAction(gameId, {
    type: 'sacrifice',
    playerId: action.playerId,
    permanentId: action.sourceId,
  });
  
  nextState = sacrificeResult.next;
  
  // 3. Search for land with specified type
  const searchResult = this.searchLibraryAction(gameId, {
    type: 'searchLibrary',
    playerId: action.playerId,
    cardType: action.landType, // e.g., "Island" or "Forest"
    maxResults: 1,
    putOnBattlefield: true,
    tapped: false, // Fetchlands put lands untapped
  });
  
  return {
    next: searchResult.next,
    log: [
      `Paid 1 life`,
      ...(sacrificeResult.log || []),
      ...(searchResult.log || []),
    ],
  };
}
