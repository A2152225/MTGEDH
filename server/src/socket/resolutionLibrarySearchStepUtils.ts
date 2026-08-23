/**
 * socket/resolutionLibrarySearchStepUtils.ts
 *
 * Helpers to filter library cards for search criteria and enqueue a
 * LIBRARY_SEARCH resolution step. Extracted from resolution.ts.
 */

import type { PlayerID } from "../../../shared/src/types.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
} from "../state/resolution/index.js";
import { debug } from "../utils/debug.js";
import { filterLibraryCardsForSearch } from "./library-search.js";

/**
 * Helper function to filter library cards based on search criteria
 * @param library - Array of library cards to filter
 * @param filter - Search criteria filter
 * @param gameState - Optional game state context for calculating variable P/T (CDA)
 * @param controllerId - Optional controller ID for CDA calculation context
 */
export function filterLibraryCards(library: any[], filter: any, gameState?: any, controllerId?: string): any[] {
  return filterLibraryCardsForSearch(library, filter, gameState, controllerId);
}

/**
 * Helper function to create a library search resolution step directly
 */
export function createLibrarySearchStep(
  game: any,
  gameId: string,
  playerId: string,
  options: {
    searchFor: string;
    destination?: string;
    tapped?: boolean;
    optional?: boolean;
    source?: string;
    shuffleAfter?: boolean;
    filter?: any;
    maxSelections?: number;
    minSelections?: number;
    reveal?: boolean;
    remainderDestination?: string;
  }
): void {
  const {
    searchFor,
    destination = 'hand',
    tapped = false,
    optional = true,
    source = 'Library Search',
    shuffleAfter = true,
    filter = {},
    maxSelections = 1,
    minSelections = 0,
    reveal = true,
    remainderDestination = 'shuffle',
  } = options;
  
  // Get player's library
  const lib = (game as any).libraries?.get(playerId) || [];
  if (lib.length === 0) {
    debug(2, `[createLibrarySearchStep] Player ${playerId} has empty library, skipping search`);
    return;
  }
  
  // Filter cards based on search criteria, passing game state for CDA calculations
  const gameState = game.state || game;
  const availableCards = filterLibraryCards(lib, filter, gameState, playerId);
  
  debug(2, `[createLibrarySearchStep] Creating library search for player ${playerId}, ${availableCards.length} matching cards`);
  
  // Create description
  let description = searchFor || 'Search your library';
  if (destination === 'battlefield') {
    description += tapped ? ' (enters tapped)' : ' (enters untapped)';
  }
  
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.LIBRARY_SEARCH,
    playerId: playerId as PlayerID,
    description,
    mandatory: !optional,
    sourceName: source,
    searchCriteria: searchFor || 'any card',
    minSelections,
    maxSelections,
    destination,
    reveal,
    shuffleAfter,
    availableCards,
    entersTapped: tapped,
    remainderDestination,
    remainderRandomOrder: true,
  });
}
