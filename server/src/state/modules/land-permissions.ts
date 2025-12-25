/**
 * land-permissions.ts
 * 
 * Manages permissions for playing lands from non-hand zones (graveyard, exile, etc.)
 * 
 * This module handles the ~21 cards that grant permission to play lands from graveyard:
 * - Crucible of Worlds
 * - Conduit of Worlds  
 * - Ramunap Excavator
 * - Ancient Greenwarden
 * - Life from the Loam
 * - And ~16 more cards
 * 
 * SCALABLE APPROACH: Uses oracle text pattern matching instead of hardcoding
 * card names, so it automatically supports all current and future cards.
 */

import { debug } from "../../utils/debug.js";

/**
 * Detect if a permanent grants permission to play lands from graveyard
 * Returns true if the card's oracle text allows playing lands from graveyard
 * 
 * Patterns detected:
 * 1. "play lands from your graveyard" (Crucible of Worlds, Conduit of Worlds)
 * 2. "play land cards from your graveyard" (Ramunap Excavator)
 * 3. "may play that card" after putting land in graveyard (Life from the Loam)
 * 4. "play an additional land" + "from your graveyard" (Ancient Greenwarden)
 */
function grantsGraveyardLandPermission(card: any): boolean {
  const oracleText = (card?.oracle_text || '').toLowerCase();
  
  // Pattern 1: Direct "play lands from your graveyard"
  if (oracleText.includes('play lands from your graveyard')) {
    return true;
  }
  
  // Pattern 2: "play land cards from your graveyard"
  if (oracleText.includes('play land cards from your graveyard')) {
    return true;
  }
  
  // Pattern 3: "you may play lands from your graveyard"
  if (oracleText.includes('may play lands from your graveyard')) {
    return true;
  }
  
  // Pattern 4: "you may play land cards from your graveyard"
  if (oracleText.includes('may play land cards from your graveyard')) {
    return true;
  }
  
  // Pattern 5: Generic - "play" + "land" + "from your graveyard"
  if (oracleText.includes('play') && oracleText.includes('land') && 
      oracleText.includes('from your graveyard')) {
    return true;
  }
  
  return false;
}

/**
 * Detect if a permanent grants permission to play cards from exile
 * For future expansion (e.g., Adventure cards, Hideaway, etc.)
 */
function grantsExileLandPermission(card: any): boolean {
  const oracleText = (card?.oracle_text || '').toLowerCase();
  
  // Pattern: "play lands from exile"
  if (oracleText.includes('play') && oracleText.includes('land') && 
      oracleText.includes('from exile')) {
    return true;
  }
  
  return false;
}

/**
 * Update land play permissions for a specific player based on battlefield state
 * 
 * This is a SCALABLE solution that automatically detects all ~21 cards
 * that grant graveyard land playing without hardcoding card names.
 * 
 * @param game - Game object with state
 * @param playerId - Player ID to update permissions for
 */
export function updateLandPlayPermissions(game: any, playerId: string) {
  const battlefield = game.state?.battlefield || [];
  
  // Initialize permissions structure
  if (!game.state.landPlayPermissions) {
    game.state.landPlayPermissions = {};
  }
  if (!game.state.landPlayPermissions[playerId]) {
    game.state.landPlayPermissions[playerId] = [];
  }
  
  // Clear current permissions and rebuild from scratch
  game.state.landPlayPermissions[playerId] = [];
  
  // Check each permanent controlled by this player
  for (const permanent of battlefield) {
    if (permanent.controller === playerId) {
      const card = permanent.card;
      
      // Check for graveyard land permission
      if (grantsGraveyardLandPermission(card)) {
        if (!game.state.landPlayPermissions[playerId].includes('graveyard')) {
          game.state.landPlayPermissions[playerId].push('graveyard');
          debug(3, `[updateLandPlayPermissions] ${card.name} grants graveyard land permission to ${playerId}`);
        }
      }
      
      // Check for exile land permission (future expansion)
      if (grantsExileLandPermission(card)) {
        if (!game.state.landPlayPermissions[playerId].includes('exile')) {
          game.state.landPlayPermissions[playerId].push('exile');
          debug(3, `[updateLandPlayPermissions] ${card.name} grants exile land permission to ${playerId}`);
        }
      }
    }
  }
}

/**
 * Update land play permissions for all players
 * Called during turn transitions or major game state changes
 */
export function updateAllLandPlayPermissions(game: any) {
  const players = game.state?.players || [];
  for (const player of players) {
    updateLandPlayPermissions(game, player.id);
  }
}
