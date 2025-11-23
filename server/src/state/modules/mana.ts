// server/src/state/modules/mana.ts
// Mana pool management and cost payment helpers

import type { GameContext } from "../context";
import type { PlayerID } from "../../shared/src/types";
import { 
  createEmptyManaPool, 
  canPayCost as engineCanPayCost, 
  autoPayCost as engineAutoPayCost,
  addManaToPool as engineAddManaToPool
} from "../../../../rules-engine/src/mana";
import type { ManaCost, ManaPool } from "../../../../shared/src/types";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

/**
 * Initialize mana pools for all players if not already present
 */
function ensureManaPools(ctx: GameContext) {
  let needsBump = false;
  
  if (!ctx.state.manaPools) {
    ctx.state.manaPools = {};
    needsBump = true;
  }
  
  // Ensure all players have a mana pool
  for (const player of ctx.state.players) {
    if (!ctx.state.manaPools[player.id]) {
      ctx.state.manaPools[player.id] = createEmptyManaPool();
      needsBump = true;
    }
  }
  
  if (needsBump) {
    ctx.bumpSeq();
  }
}

/**
 * Get a player's mana pool (readonly)
 */
export function getManaPool(ctx: GameContext, playerId: PlayerID): Readonly<ManaPool> {
  ensureManaPools(ctx);
  return ctx.state.manaPools![playerId] || createEmptyManaPool();
}

/**
 * Add mana to a player's pool
 */
export function addMana(
  ctx: GameContext, 
  playerId: PlayerID, 
  color: keyof ManaPool, 
  amount: number
): void {
  ensureManaPools(ctx);
  const currentPool = ctx.state.manaPools![playerId] || createEmptyManaPool();
  ctx.state.manaPools![playerId] = engineAddManaToPool(currentPool, color, amount);
  ctx.bumpSeq();
  console.log(`${ts()} [addMana] Added ${amount} ${color} mana to ${playerId}'s pool`);
}

/**
 * Check if a player can pay a cost
 */
export function canPayCost(ctx: GameContext, playerId: PlayerID, cost: ManaCost): boolean {
  const pool = getManaPool(ctx, playerId);
  return engineCanPayCost(pool, cost);
}

/**
 * Automatically pay a cost from a player's mana pool
 * Returns true if payment succeeded, false if insufficient mana
 */
export function autoPayCost(ctx: GameContext, playerId: PlayerID, cost: ManaCost): boolean {
  const pool = getManaPool(ctx, playerId);
  const newPool = engineAutoPayCost(pool, cost);
  
  if (!newPool) {
    console.log(`${ts()} [autoPayCost] Insufficient mana for ${playerId}`);
    return false;
  }
  
  ensureManaPools(ctx);
  ctx.state.manaPools![playerId] = newPool;
  ctx.bumpSeq();
  console.log(`${ts()} [autoPayCost] Paid cost for ${playerId}`);
  return true;
}

/**
 * Tap a permanent for mana
 * Validates controller and tapped status, identifies land type, adds mana
 */
export function tapForMana(
  ctx: GameContext,
  playerId: PlayerID,
  permanentId: string,
  manaChoice?: keyof ManaPool
): { success: boolean; reason?: string } {
  const perm = ctx.state.battlefield.find(p => p.id === permanentId);
  
  if (!perm) {
    return { success: false, reason: 'Permanent not found' };
  }
  
  if (perm.controller !== playerId) {
    return { success: false, reason: 'You do not control this permanent' };
  }
  
  if (perm.tapped) {
    return { success: false, reason: 'Permanent is already tapped' };
  }
  
  // Tap the permanent
  perm.tapped = true;
  
  // Determine mana to add
  let manaColor: keyof ManaPool = 'C'; // Default to colorless
  
  const typeLine = (perm.card as any)?.type_line?.toLowerCase() || '';
  
  // If mana choice is provided (for future multi-color lands), use it
  if (manaChoice) {
    manaColor = manaChoice;
  } else {
    // Identify basic land types
    if (typeLine.includes('plains')) {
      manaColor = 'W';
    } else if (typeLine.includes('island')) {
      manaColor = 'U';
    } else if (typeLine.includes('swamp')) {
      manaColor = 'B';
    } else if (typeLine.includes('mountain')) {
      manaColor = 'R';
    } else if (typeLine.includes('forest')) {
      manaColor = 'G';
    }
    // Otherwise defaults to colorless
  }
  
  // Add the mana
  addMana(ctx, playerId, manaColor, 1);
  
  console.log(`${ts()} [tapForMana] ${playerId} tapped ${permanentId} for ${manaColor} mana`);
  
  return { success: true };
}

/**
 * Clear a player's mana pool (for step/phase transitions)
 */
export function clearManaPool(ctx: GameContext, playerId: PlayerID): void {
  ensureManaPools(ctx);
  ctx.state.manaPools![playerId] = createEmptyManaPool();
  ctx.bumpSeq();
  console.log(`${ts()} [clearManaPool] Cleared mana pool for ${playerId}`);
}

/**
 * Clear all mana pools (called at step/phase boundaries)
 */
export function clearAllManaPools(ctx: GameContext): void {
  for (const player of ctx.state.players) {
    clearManaPool(ctx, player.id);
  }
}

export default {
  getManaPool,
  addMana,
  canPayCost,
  autoPayCost,
  tapForMana,
  clearManaPool,
  clearAllManaPools,
};
