/**
 * goad-effects.ts
 * 
 * Helper functions for applying and managing goad effects (Rule 701.15)
 * Supports:
 * - Single creature goad
 * - Mass goad (all creatures a player controls)
 * - Conditional goad (e.g., based on power comparison)
 * - Goad from auras, equipment, and triggered abilities
 */

import type { BattlefieldPermanent, PlayerID } from '../../../../shared/src/types';
import { debug, debugWarn, debugError } from "../../utils/debug.js";

/**
 * Apply goad to a single creature (Rule 701.15)
 * 
 * @param creature - The creature to goad
 * @param goaderId - Player ID who is goading
 * @param expiryTurn - Turn number when the goad expires (goader's next turn)
 * @returns Updated creature with goad applied
 */
export function applyGoadToCreature(
  creature: BattlefieldPermanent,
  goaderId: PlayerID,
  expiryTurn: number
): BattlefieldPermanent {
  // Rule 701.15d: Redundant goad has no effect
  const existingGoaders = creature.goadedBy || [];
  if (existingGoaders.includes(goaderId)) {
    // Already goaded by this player
    return creature;
  }
  
  // Add goader to the list
  const newGoadedBy = [...existingGoaders, goaderId];
  
  // Update or create goadedUntil map
  const existingGoadedUntil = creature.goadedUntil || {};
  const newGoadedUntil = {
    ...existingGoadedUntil,
    [goaderId]: expiryTurn,
  };
  
  return {
    ...creature,
    goadedBy: newGoadedBy,
    goadedUntil: newGoadedUntil,
  };
}

/**
 * Apply goad to multiple creatures
 * 
 * @param creatures - Array of creatures to goad
 * @param goaderId - Player ID who is goading
 * @param expiryTurn - Turn number when the goad expires
 * @returns Array of updated creatures
 */
export function applyGoadToCreatures(
  creatures: BattlefieldPermanent[],
  goaderId: PlayerID,
  expiryTurn: number
): BattlefieldPermanent[] {
  return creatures.map(c => applyGoadToCreature(c, goaderId, expiryTurn));
}

/**
 * Apply goad to all creatures a player controls
 * 
 * @param battlefield - Array of all battlefield permanents
 * @param targetPlayerId - Player whose creatures will be goaded
 * @param goaderId - Player ID who is goading
 * @param expiryTurn - Turn number when the goad expires
 * @returns Updated battlefield array
 */
export function goadAllCreaturesControlledBy(
  battlefield: BattlefieldPermanent[],
  targetPlayerId: PlayerID,
  goaderId: PlayerID,
  expiryTurn: number
): BattlefieldPermanent[] {
  return battlefield.map(perm => {
    // Check if this is a creature controlled by the target player
    if (perm.controller === targetPlayerId && isCreature(perm)) {
      return applyGoadToCreature(perm, goaderId, expiryTurn);
    }
    return perm;
  });
}

/**
 * Apply conditional goad (e.g., Baeloth Barrityl - goad creatures with lower power)
 * 
 * @param battlefield - Array of all battlefield permanents
 * @param goaderId - Player ID who is goading
 * @param expiryTurn - Turn number when the goad expires
 * @param condition - Function that determines if a creature should be goaded
 * @returns Updated battlefield array
 */
export function applyConditionalGoad(
  battlefield: BattlefieldPermanent[],
  goaderId: PlayerID,
  expiryTurn: number,
  condition: (creature: BattlefieldPermanent) => boolean
): BattlefieldPermanent[] {
  return battlefield.map(perm => {
    if (isCreature(perm) && condition(perm)) {
      return applyGoadToCreature(perm, goaderId, expiryTurn);
    }
    return perm;
  });
}

/**
 * Remove expired goad effects
 * Should be called at the start of each player's turn
 * 
 * @param battlefield - Array of all battlefield permanents
 * @param currentTurn - Current turn number
 * @param currentPlayerId - Current player ID (whose turn it is)
 * @returns Updated battlefield array
 */
export function removeExpiredGoads(
  battlefield: BattlefieldPermanent[],
  currentTurn: number,
  currentPlayerId: PlayerID
): BattlefieldPermanent[] {
  return battlefield.map(perm => {
    if (!perm.goadedBy || perm.goadedBy.length === 0) {
      return perm;
    }
    
    // Check if any goad effects have expired
    const goadedUntil = perm.goadedUntil || {};
    const activeGoaders = perm.goadedBy.filter(goaderId => {
      const expiryTurn = goadedUntil[goaderId];
      // Goad expires at the start of the goader's next turn
      return expiryTurn === undefined || expiryTurn > currentTurn || goaderId !== currentPlayerId;
    });
    
    if (activeGoaders.length === perm.goadedBy.length) {
      // No changes needed
      return perm;
    }
    
    if (activeGoaders.length === 0) {
      // Remove all goad data
      const { goadedBy, goadedUntil, ...rest } = perm;
      return rest as BattlefieldPermanent;
    }
    
    // Update with only active goaders
    const newGoadedUntil: Record<string, number> = {};
    for (const goaderId of activeGoaders) {
      if (goadedUntil[goaderId] !== undefined) {
        newGoadedUntil[goaderId] = goadedUntil[goaderId];
      }
    }
    
    return {
      ...perm,
      goadedBy: activeGoaders,
      goadedUntil: newGoadedUntil,
    };
  });
}

/**
 * Check if a permanent is currently a creature
 * (Simplified version - uses type line check)
 */
function isCreature(permanent: BattlefieldPermanent): boolean {
  const typeLine = (permanent.card?.type_line || '').toLowerCase();
  return typeLine.includes('creature');
}

/**
 * Get effective power of a creature for conditional goad checks
 */
export function getEffectivePower(creature: BattlefieldPermanent): number {
  // Use pre-calculated effective power if available
  if (typeof creature.effectivePower === 'number') {
    return creature.effectivePower;
  }
  
  // Fallback calculation
  const basePower = creature.basePower ?? 0;
  const plusCounters = creature.counters?.['+1/+1'] ?? 0;
  const minusCounters = creature.counters?.['-1/-1'] ?? 0;
  
  return Math.max(0, basePower + plusCounters - minusCounters);
}

/**
 * Example: Baeloth Barrityl, Entertainer condition
 * "Creatures your opponents control with power less than Baeloth Barrityl's power are goaded."
 */
export function baelothGoadCondition(
  baelothPower: number,
  baelothController: PlayerID
): (creature: BattlefieldPermanent) => boolean {
  return (creature: BattlefieldPermanent) => {
    // Must be an opponent's creature
    if (creature.controller === baelothController) {
      return false;
    }
    
    // Must have lower power
    const creaturePower = getEffectivePower(creature);
    return creaturePower < baelothPower;
  };
}

/**
 * Log goad application for debugging
 */
export function logGoadApplication(
  creatureName: string,
  goaderId: string,
  expiryTurn: number,
  reason: string = 'effect'
): void {
  debug(2, `[goad] ${creatureName} goaded by ${goaderId} until turn ${expiryTurn} (${reason})`);
}

