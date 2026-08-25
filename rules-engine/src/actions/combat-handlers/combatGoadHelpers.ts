// Origin parent: rules-engine/src/actions/combat.ts
// Cluster moved: buildProcessedBattlefieldForGoad, getBattlefieldStaticGoaders,
// isGoaded, getGoadedBy, getGoadedAttackTargets, canGoadedCreatureAttack.
// Public entry symbols: isGoaded, getGoadedBy, getGoadedAttackTargets,
// canGoadedCreatureAttack, buildProcessedBattlefieldForGoad.
// Leaf must not import actions/combat.ts or combat-handlers/index.ts.

import type { BattlefieldPermanent } from '../../../../shared/src';
import { applyStaticAbilitiesToBattlefield } from '../../staticAbilities';
import { getPermanentForGoadAnalysis } from './combatGoadPermanentLookup.js';
import { getPermanentPower } from './combatPermanentPower.js';

/**
 * Check if a permanent is goaded (Rule 701.15)
 * Checks both:
 * 1. Direct goad effects stored on the permanent (goadedBy array)
 * 2. Static goad effects from staticAbilities.ts (isStaticallyGoaded flag)
 * 
 * @param permanent - The permanent to check
 * @param currentTurn - Current turn number (optional, for expiration checking)
 * @param battlefield - Optional battlefield array (deprecated - static goad now uses isStaticallyGoaded flag)
 * @returns true if the permanent is currently goaded by any player
 */
export function buildProcessedBattlefieldForGoad(battlefield?: any[]): any[] {
  if (!Array.isArray(battlefield) || battlefield.length === 0) return [];
  try {
    return applyStaticAbilitiesToBattlefield(battlefield as BattlefieldPermanent[]) as any[];
  } catch {
    return battlefield;
  }
}


function addUniqueGoaders(target: string[], source: readonly string[] | undefined): void {
  if (!Array.isArray(source)) return;
  for (const goaderId of source) {
    const normalized = String(goaderId || '').trim();
    if (normalized && !target.includes(normalized)) {
      target.push(normalized);
    }
  }
}

function getBattlefieldStaticGoaders(permanent: any, battlefield?: any[]): string[] {
  if (!permanent || !Array.isArray(battlefield) || battlefield.length === 0) return [];

  const processedBattlefield = buildProcessedBattlefieldForGoad(battlefield);
  const analyzedPermanent = getPermanentForGoadAnalysis(permanent, processedBattlefield);
  if (!analyzedPermanent) return [];

  const goaders: string[] = [];
  addUniqueGoaders(goaders, analyzedPermanent.isStaticallyGoaded ? analyzedPermanent.staticGoadedBy : undefined);

  const permanentId = String((analyzedPermanent as any)?.id || '').trim();
  const permanentPower = getPermanentPower(analyzedPermanent);

  for (const source of processedBattlefield) {
    const sourceId = String((source as any)?.id || '').trim();
    const sourceController = String((source as any)?.controller || '').trim();
    const sourceOracle = String((source as any)?.card?.oracle_text || (source as any)?.oracle_text || '').toLowerCase();
    if (!sourceOracle) continue;

    if (sourceId && permanentId && sourceId !== permanentId && String((source as any)?.attachedTo || '').trim() === permanentId) {
      if (/(?:enchanted|equipped)\s+creature\b[^.]*\bis goaded\b/i.test(sourceOracle)) {
        if (sourceController && !goaders.includes(sourceController)) {
          goaders.push(sourceController);
        }
      }
    }

    if (!sourceController || sourceController === String((analyzedPermanent as any)?.controller || '').trim()) {
      continue;
    }

    if (
      sourceOracle.includes('creatures your opponents control') &&
      sourceOracle.includes('power less than') &&
      sourceOracle.includes('are goaded')
    ) {
      const sourcePower = getPermanentPower(source);
      if (permanentPower < sourcePower && !goaders.includes(sourceController)) {
        goaders.push(sourceController);
      }
    }
  }

  return goaders;
}

export function isGoaded(permanent: any, currentTurn?: number, battlefield?: any[]): boolean {
  return getGoadedBy(permanent, currentTurn, battlefield).length > 0;
}

/**
 * Get the list of player IDs who have goaded this creature (Rule 701.15)
 * 
 * @param permanent - The permanent to check
 * @param currentTurn - Current turn number (optional, for expiration checking)
 * @returns Array of player IDs who have goaded this creature
 */
export function getGoadedBy(permanent: any, currentTurn?: number, battlefield?: any[]): string[] {
  const goaders: string[] = [];
  const processedBattlefield = buildProcessedBattlefieldForGoad(battlefield);
  const analyzedPermanent = getPermanentForGoadAnalysis(permanent, processedBattlefield);
  if (!analyzedPermanent) return goaders;
  
  // Check for static goad sources (Baeloth, etc.)
  addUniqueGoaders(goaders, analyzedPermanent.isStaticallyGoaded ? analyzedPermanent.staticGoadedBy : undefined);
  addUniqueGoaders(goaders, getBattlefieldStaticGoaders(analyzedPermanent, processedBattlefield));
  
  // Check for direct goad effects
  if (analyzedPermanent.goadedBy && Array.isArray(analyzedPermanent.goadedBy)) {
    // If no turn tracking, return all goaders
    if (currentTurn === undefined) {
      for (const goaderId of analyzedPermanent.goadedBy) {
        if (!goaders.includes(goaderId)) {
          goaders.push(goaderId);
        }
      }
    } else {
      // Filter to only active goad effects
      const goadedUntil = analyzedPermanent.goadedUntil || {};
      for (const goaderId of analyzedPermanent.goadedBy) {
        const expiryTurn = goadedUntil[goaderId];
        if (expiryTurn === undefined || expiryTurn > currentTurn) {
          if (!goaders.includes(goaderId)) {
            goaders.push(goaderId);
          }
        }
      }
    }
  }

  // Legacy replay/state shape: { [goaderId]: true }
  if (analyzedPermanent.goaded && typeof analyzedPermanent.goaded === 'object' && !Array.isArray(analyzedPermanent.goaded)) {
    for (const [legacyGoader, active] of Object.entries(analyzedPermanent.goaded as Record<string, unknown>)) {
      if (!active) continue;
      addUniqueGoaders(goaders, [legacyGoader]);
    }
  }
  
  return goaders;
}

/**
 * Get valid attack targets for a goaded creature (Rule 701.15b)
 * A goaded creature must attack a player other than the goader if able.
 * It can only attack the goader if there are no other valid attack targets.
 * 
 * @param permanent - The goaded creature
 * @param allPlayers - All player IDs in the game
 * @param currentTurn - Current turn number (for expiration checking)
 * @returns Array of valid player IDs this creature can attack
 */
export function getGoadedAttackTargets(
  permanent: any,
  allPlayers: string[],
  currentTurn?: number,
  battlefield?: any[]
): string[] {
  const goaders = getGoadedBy(permanent, currentTurn, battlefield);
  if (goaders.length === 0) {
    // Not goaded, can attack anyone except controller
    return allPlayers.filter(p => p !== permanent.controller);
  }
  
  // Get non-goader opponents
  const nonGoaderOpponents = allPlayers.filter(p => 
    p !== permanent.controller && !goaders.includes(p)
  );
  
  // Rule 701.15b: Must attack a player other than the goader if able
  if (nonGoaderOpponents.length > 0) {
    return nonGoaderOpponents;
  }
  
  // Only goaders are available - can attack them as they are the only option
  return goaders;
}

/**
 * Check if a goaded creature can attack a specific player (Rule 701.15b)
 * 
 * @param permanent - The creature to check
 * @param targetPlayerId - The player ID to attack
 * @param allPlayers - All player IDs in the game
 * @param currentTurn - Current turn number (for expiration checking)
 * @returns Object with canAttack flag and reason if blocked
 */
export function canGoadedCreatureAttack(
  permanent: any,
  targetPlayerId: string,
  allPlayers: string[],
  currentTurn?: number,
  battlefield?: any[]
): { canAttack: boolean; reason?: string } {
  if (!isGoaded(permanent, currentTurn, battlefield)) {
    // Not goaded, use normal attack rules
    return { canAttack: true };
  }
  
  const validTargets = getGoadedAttackTargets(permanent, allPlayers, currentTurn, battlefield);
  
  if (!validTargets.includes(targetPlayerId)) {
    const goaders = getGoadedBy(permanent, currentTurn, battlefield);
    if (goaders.includes(targetPlayerId)) {
      return { 
        canAttack: false, 
        reason: 'Goaded creature cannot attack the player who goaded it (unless they are the only option)' 
      };
    }
    return { canAttack: false, reason: 'Invalid attack target for goaded creature' };
  }
  
  return { canAttack: true };
}
