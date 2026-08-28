// server/src/state/modules/turn-handlers/turnCombatDamageTracking.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: syncLifeAndCheckDefeat, trackCommanderDamage,
// trackCreatureDamageToPlayer, didCreatureDealDamageToPlayer,
// getCreaturesThatDealtDamageToPlayer.
// Public entry symbols: those five functions.
// Leaf must not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import { markPlayerOutOfPriority } from "../priorityEligibility.js";
import { removeLeavingPlayerGameObjects } from "../playerLeavingGame.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

/**
 * Sync life totals between state.life dictionary and player objects in state.players.
 * Also checks for state-based actions (player defeat due to 0 or less life).
 * 
 * Returns list of player IDs that have been defeated (life <= 0).
 */
export function syncLifeAndCheckDefeat(ctx: GameContext): string[] {
  const defeatedPlayers: string[] = [];
  
  try {
    const state = (ctx as any).state;
    if (!state) return defeatedPlayers;
    
    const players = state.players || [];
    const life = state.life = state.life || {};
    const startingLife = state.startingLife || 40;
    
    // state.life is the authoritative source for life totals
    // Player objects in state.players are synchronized from state.life
    for (const player of players) {
      if (!player || !player.id) continue;
      
      // Initialize life in state.life if not present
      if (life[player.id] === undefined) {
        life[player.id] = player.life ?? startingLife;
      }
      
      // Always sync player.life FROM state.life (single source of truth)
      player.life = life[player.id];
      
      // Check for player defeat (Rule 704.5a: Life <= 0)
      if (player.life <= 0 && !player.hasLost) {
        player.hasLost = true;
        player.lossReason = "Life total is 0 or less";
        defeatedPlayers.push(player.id);
        debug(1, `${ts()} [syncLifeAndCheckDefeat] Player ${player.id} has lost the game (life: ${player.life})`);
        markPlayerOutOfPriority(ctx as any, player.id);
        removeLeavingPlayerGameObjects(state, player.id, { gameId: String((ctx as any).gameId || '') });
      }

      const poisonTotal = Math.max(
        0,
        Number(state.poisonCounters?.[player.id]) ||
          Number((ctx as any).poison?.[player.id]) ||
          Number(player.poisonCounters) ||
          0,
      );
      if (poisonTotal >= 10 && !player.hasLost) {
        player.hasLost = true;
        player.lossReason = "10 or more poison counters";
        defeatedPlayers.push(player.id);
        debug(1, `${ts()} [syncLifeAndCheckDefeat] Player ${player.id} has lost the game (poison: ${poisonTotal})`);
        markPlayerOutOfPriority(ctx as any, player.id);
        removeLeavingPlayerGameObjects(state, player.id, { gameId: String((ctx as any).gameId || '') });
      }
    }
    
  } catch (err) {
    debugWarn(1, `${ts()} syncLifeAndCheckDefeat failed:`, err);
  }
  
  return defeatedPlayers;
}

/**
 * Track commander damage and check for 21+ damage loss condition (Rule 903.10a)
 * 
 * @param ctx Game context
 * @param attackerController Controller of the attacking commander
 * @param attackerCard The commander's card data
 * @param attacker The commander permanent
 * @param defendingPlayerId The player taking damage
 * @param damageAmount Amount of combat damage dealt
 */
export function trackCommanderDamage(
  ctx: GameContext,
  attackerController: string,
  attackerCard: any,
  attacker: any,
  defendingPlayerId: string,
  damageAmount: number
): void {
  if (damageAmount <= 0) return;
  
  // Check if attacker is a commander
  const isCommander = attacker.isCommander === true || 
                     (ctx as any).state?.commandZone?.[attackerController]?.commanderIds?.includes(attackerCard.id);
  
  if (!isCommander) return;
  
  // Initialize commander damage tracking if needed
  (ctx as any).state.commanderDamage = (ctx as any).state.commanderDamage || {};
  (ctx as any).state.commanderDamage[defendingPlayerId] = (ctx as any).state.commanderDamage[defendingPlayerId] || {};
  
  // Use the card ID as the commander identifier (consistent across zones)
  const commanderId = attackerCard.id || attacker.id;
  const previousDamage = (ctx as any).state.commanderDamage[defendingPlayerId][commanderId] || 0;
  const totalDamage = previousDamage + damageAmount;
  (ctx as any).state.commanderDamage[defendingPlayerId][commanderId] = totalDamage;
  
  debug(1, `${ts()} [dealCombatDamage] COMMANDER DAMAGE: ${attackerCard.name || 'Commander'} dealt ${damageAmount} to ${defendingPlayerId} (total: ${totalDamage}/21)`);
  
  // Check for commander damage loss (21+)
  if (totalDamage >= 21) {
    debug(1, `${ts()} [dealCombatDamage] ⚠️ COMMANDER DAMAGE LETHAL: ${defendingPlayerId} has taken 21+ damage from ${attackerCard.name || 'Commander'}`);
    const players = (ctx as any).state?.players || [];
    const defeatedPlayer = players.find((p: any) => p.id === defendingPlayerId);
    if (defeatedPlayer && !defeatedPlayer.hasLost) {
      defeatedPlayer.hasLost = true;
      defeatedPlayer.lossReason = `21 or more combat damage from ${attackerCard.name || 'a commander'}`;
      markPlayerOutOfPriority(ctx as any, defendingPlayerId);
      removeLeavingPlayerGameObjects((ctx as any).state, defendingPlayerId, { gameId: String((ctx as any).gameId || '') });
      debug(1, `${ts()} [dealCombatDamage] Player ${defendingPlayerId} marked as inactive (commander damage)`);
    }
  }
}

/**
 * Track that a creature dealt damage to a player this turn.
 * This is used by cards like Reciprocate that can only target creatures that dealt damage to you this turn.
 * 
 * @param ctx Game context
 * @param creaturePermanentId The permanent ID of the creature that dealt damage
 * @param creatureName The name of the creature (for logging)
 * @param damagedPlayerId The player who was damaged
 * @param damageAmount Amount of damage dealt
 */
export function trackCreatureDamageToPlayer(
  ctx: GameContext,
  creaturePermanentId: string,
  creatureName: string,
  damagedPlayerId: string,
  damageAmount: number
): void {
  if (damageAmount <= 0) return;
  
  // Initialize tracking structure if needed
  // Structure: creaturesThatDealtDamageToPlayer[playerId] = Set of creature permanent IDs
  (ctx as any).state.creaturesThatDealtDamageToPlayer = (ctx as any).state.creaturesThatDealtDamageToPlayer || {};
  
  // Use an object to track creature IDs (since JSON doesn't serialize Sets)
  const playerDamageTracker = (ctx as any).state.creaturesThatDealtDamageToPlayer[damagedPlayerId] = 
    (ctx as any).state.creaturesThatDealtDamageToPlayer[damagedPlayerId] || {};
  
  // Track this creature as having dealt damage to this player
  playerDamageTracker[creaturePermanentId] = {
    creatureName,
    totalDamage: (playerDamageTracker[creaturePermanentId]?.totalDamage || 0) + damageAmount,
    lastDamageTime: Date.now(),
  };
  
  debug(2, `${ts()} [trackCreatureDamageToPlayer] ${creatureName} (${creaturePermanentId}) dealt ${damageAmount} damage to ${damagedPlayerId}`);
}

/**
 * Check if a creature dealt damage to a specific player this turn.
 * Used for cards like Reciprocate that have targeting restrictions based on damage dealt.
 * 
 * @param ctx Game context
 * @param creaturePermanentId The permanent ID of the creature to check
 * @param damagedPlayerId The player to check damage against
 * @returns true if the creature dealt damage to the player this turn
 */
export function didCreatureDealDamageToPlayer(
  ctx: GameContext,
  creaturePermanentId: string,
  damagedPlayerId: string
): boolean {
  const damageTracker = (ctx as any).state?.creaturesThatDealtDamageToPlayer?.[damagedPlayerId];
  if (!damageTracker) return false;
  
  return !!damageTracker[creaturePermanentId];
}

/**
 * Get all creatures that dealt damage to a specific player this turn.
 * Used by targeting systems for cards like Reciprocate.
 * 
 * @param ctx Game context
 * @param damagedPlayerId The player to get damage sources for
 * @returns Array of permanent IDs of creatures that dealt damage to this player this turn
 */
export function getCreaturesThatDealtDamageToPlayer(
  ctx: GameContext,
  damagedPlayerId: string
): string[] {
  const damageTracker = (ctx as any).state?.creaturesThatDealtDamageToPlayer?.[damagedPlayerId];
  if (!damageTracker) return [];
  
  return Object.keys(damageTracker);
}
