// Origin parent: rules-engine/src/actions/combat.ts
// Cluster moved: getGoadedAttackers.
// Public entry symbols: getGoadedAttackers.
// Leaf must not import actions/combat.ts or combat-handlers/index.ts.

import type { GameState } from '../../../../shared/src';
import { buildProcessedBattlefieldForGoad, isGoaded } from './combatGoadHelpers.js';
import { canPermanentAttack } from './combatLegalityHelpers.js';

/**
 * Get all goaded creatures that must attack (Rule 701.15b)
 * Returns creatures that are goaded and can legally attack
 * Note: Static goad effects (Baeloth, etc.) are now handled by applyStaticAbilitiesToBattlefield
 * which sets isStaticallyGoaded flag on affected creatures.
 * 
 * @param state - The game state
 * @param playerId - The player declaring attackers
 * @returns Array of permanent IDs that are goaded and must attack
 */
export function getGoadedAttackers(state: GameState, playerId: string): string[] {
  const goadedAttackers: string[] = [];
  const currentTurn = state.turn;
  const battlefield = buildProcessedBattlefieldForGoad(state.battlefield as any[] | undefined);
  
  // Check global battlefield (single source of truth)
  for (const perm of battlefield) {
    if (perm.controller === playerId && isGoaded(perm, currentTurn, battlefield)) {
      const result = canPermanentAttack(perm, playerId, battlefield);
      if (result.canParticipate) {
        goadedAttackers.push(perm.id);
      }
    }
  }
  
  return goadedAttackers;
}
