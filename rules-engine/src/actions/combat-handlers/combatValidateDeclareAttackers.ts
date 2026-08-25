// Origin parent: rules-engine/src/actions/combat.ts
// Cluster moved: validateDeclareAttackers.
// Public entry symbols: validateDeclareAttackers.
// Leaf must not import actions/combat.ts or combat-handlers/index.ts.

import type { GameState } from '../../../../shared/src';
import { GameStep as SharedGameStep } from '../../../../shared/src';
import type { AttackCostCheckResult } from '../../pillowfortEffects';
import { checkAttackCosts, getAttackCostDescription } from '../../pillowfortEffects';
import { getCombinedPermanentText } from '../../permanentText';
import {
  getAttackProhibitionSourceForPlayer,
  getIllegalDefendingPlayerRestriction,
  permanentHasMustAttackRequirement,
} from '../../attackRestrictionText';
import type { DeclareAttackersAction } from './combatActionTypes.js';
import {
  buildProcessedBattlefieldForGoad,
  canGoadedCreatureAttack,
  isGoaded,
} from './combatGoadHelpers.js';
import { getGoadedAttackers } from './combatGoadedAttackers.js';
import { canPermanentAttack, isCurrentlyCreature } from './combatLegalityHelpers.js';

/**
 * Validate declare attackers action
 * Uses comprehensive combat validation to check:
 * - Permanent must be a creature (not enchantment, artifact, etc.)
 * - Must be untapped
 * - Must not have defender
 * - Must not have summoning sickness (unless has haste)
 * - Must not have "can't attack" effects
 * - Must be able to pay pillowfort costs (Propaganda, Ghostly Prison, etc.)
 */
export function validateDeclareAttackers(
  state: GameState,
  action: DeclareAttackersAction
): { legal: boolean; reason?: string; pillowfortCosts?: AttackCostCheckResult } {
  const battlefield = buildProcessedBattlefieldForGoad(state.battlefield as any[] | undefined);
  // Check if it's the declare attackers step
  if (state.step !== SharedGameStep.DECLARE_ATTACKERS) {
    return { legal: false, reason: 'Not in declare attackers step' };
  }
  
  // Check if player is active player
  const activePlayer = state.players[state.activePlayerIndex || 0];
  if (activePlayer?.id !== action.playerId) {
    return { legal: false, reason: 'Only active player can declare attackers' };
  }
  
  // Validate each attacker using comprehensive validation
  for (const attacker of action.attackers) {
    const attackProhibitionSource = getAttackProhibitionSourceForPlayer(battlefield, attacker.defendingPlayerId);
    if (attackProhibitionSource) {
      return {
        legal: false,
        reason: `${attacker.defendingPlayerId} can't be attacked while ${attackProhibitionSource} is on the battlefield`,
      };
    }

    // Check global battlefield (single source of truth)
    const permanent = battlefield.find(
      (p: any) => p.id === attacker.creatureId && p.controller === action.playerId
    );
    
    if (!permanent) {
      return { legal: false, reason: `Permanent ${attacker.creatureId} not found on battlefield` };
    }
    
    // Use comprehensive attack validation
    const validationResult = canPermanentAttack(permanent, action.playerId, battlefield, attacker.defendingPlayerId);
    if (!validationResult.canParticipate) {
      return { legal: false, reason: validationResult.reason || 'Cannot attack with this permanent' };
    }
    
    // Check goad restrictions (Rule 701.15b)
    // Static goad effects (Baeloth) are now handled via isStaticallyGoaded flag
    if (isGoaded(permanent, state.turn, battlefield)) {
      const allPlayerIds = state.players.map(p => p.id);
      const goadCheck = canGoadedCreatureAttack(
        permanent,
        attacker.defendingPlayerId,
        allPlayerIds,
        state.turn,
        battlefield
      );
      if (!goadCheck.canAttack) {
        return { 
          legal: false, 
          reason: goadCheck.reason || 'Goaded creature cannot attack this player' 
        };
      }
    }
  }
  
  // Check that all goaded creatures are attacking (Rule 701.15b)
  const goadedCreatures = getGoadedAttackers(state, action.playerId);
  const attackingCreatureIds = new Set(action.attackers.map(a => a.creatureId));
  
  for (const goadedId of goadedCreatures) {
    if (!attackingCreatureIds.has(goadedId)) {
      // Find the creature for error message (global battlefield only)
      const creature = battlefield.find((p: any) => p.id === goadedId);
      const creatureName = creature?.card?.name || 'Goaded creature';
      return { 
        legal: false, 
        reason: `${creatureName} is goaded and must attack if able (Rule 701.15b)` 
      };
    }
  }

  const opponentIds = (state.players || [])
    .filter((player: any) => {
      const id = String(player?.id || '').trim();
      return Boolean(id) && id !== action.playerId && !player?.hasLost;
    })
    .map((player: any) => String(player.id));

  for (const perm of battlefield) {
    if (String(perm?.controller || '') !== action.playerId) continue;
    if (!isCurrentlyCreature(perm)) continue;
    if (attackingCreatureIds.has(perm.id)) continue;
    if (!permanentHasMustAttackRequirement(perm, battlefield)) continue;

    const canAttack = canPermanentAttack(perm, action.playerId, battlefield);
    if (!canAttack.canParticipate) continue;

    const legalDefenders = opponentIds.filter((opponentId) => {
      const restriction = getIllegalDefendingPlayerRestriction({
        oracleText: getCombinedPermanentText(perm),
        ownerId: perm.owner || (perm as any).ownerId,
        controllerId: action.playerId,
        defendingPlayerId: opponentId,
        cantAttackOwner: Boolean((perm as any).cantAttackOwner),
      });
      if (restriction.illegal) return false;
      return canPermanentAttack(perm, action.playerId, battlefield, opponentId).canParticipate;
    });
    if (legalDefenders.length === 0) continue;

    const creatureName = perm.card?.name || 'Creature';
    return {
      legal: false,
      reason: `${creatureName} attacks each combat if able`,
    };
  }
  
  // Check pillowfort costs for each defending player
  // Group attackers by defending player to check costs per defender
  const attackersByDefender = new Map<string, number>();
  for (const attacker of action.attackers) {
    const current = attackersByDefender.get(attacker.defendingPlayerId) || 0;
    attackersByDefender.set(attacker.defendingPlayerId, current + 1);
  }
  
  // Check if attacker can afford pillowfort costs for each defender
  const defenderEntries = Array.from(attackersByDefender.entries());
  for (const [defendingPlayerId, creatureCount] of defenderEntries) {
    const costCheck = checkAttackCosts(
      state,
      action.playerId,
      defendingPlayerId,
      creatureCount
    );
    
    if (!costCheck.canAffordAll && costCheck.requirements.length > 0) {
      const description = getAttackCostDescription(
        costCheck.requirements,
        creatureCount,
        costCheck.totalManaCost,
        costCheck.totalLifeCost
      );
      return { 
        legal: false, 
        reason: `Cannot afford attack costs: ${description}`,
        pillowfortCosts: costCheck,
      };
    }
  }
  
  return { legal: true };
}
