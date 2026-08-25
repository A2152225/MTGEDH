// Origin parent: rules-engine/src/AutomationService.ts
// Cluster moved: calculateCombatDamage, applyCombatDamage, exclusive combat helpers,
//   and CombatDamageAssignment.
// Public entry symbols: calculateCombatDamage, applyCombatDamage, CombatDamageAssignment.
// Leaf must not import AutomationService.ts or AutomationService-handlers/index.ts.

import type { GameState, BattlefieldPermanent } from '../../../shared/src';
import { previewPreventedDamage } from '../oracleIRDamagePrevention';
import { applyStaticAbilitiesToBattlefield } from '../staticAbilities';
import { DecisionType, type PendingDecision } from './automationServiceDecisionTypes.js';

/**
 * Auto-calculate and apply combat damage
 */
export function calculateCombatDamage(state: GameState): {
  damageAssignments: CombatDamageAssignment[];
  requiresPlayerInput: boolean;
  pendingDecisions: PendingDecision[];
} {
  const assignments: CombatDamageAssignment[] = [];
  const pendingDecisions: PendingDecision[] = [];
  let requiresPlayerInput = false;
  
  const battlefield = applyStaticAbilitiesToBattlefield((state.battlefield || []) as BattlefieldPermanent[]);
  const attackers = battlefield.filter((p: BattlefieldPermanent) => p.attacking);
  
  for (const attacker of attackers) {
    const card = attacker.card as any;
    const power = getCombatPower(attacker);
    const blockers = attacker.blockedBy || [];
    
    if (blockers.length === 0) {
      // Unblocked - damage goes to defending player
      const defendingPlayer = attacker.attacking as string;
      assignments.push({
        sourceId: attacker.id,
        sourceName: card?.name,
        targetId: defendingPlayer,
        targetType: 'player',
        damage: power,
        isLethal: false,
      });
    } else if (blockers.length === 1) {
      // Single blocker - damage goes to it
      const blocker = battlefield.find((p: BattlefieldPermanent) => p.id === blockers[0]);
      if (blocker) {
        assignments.push({
          sourceId: attacker.id,
          sourceName: card?.name,
          targetId: blockers[0],
          targetType: 'creature',
          damage: power,
          isLethal: power >= getCombatToughness(blocker),
        });
      }
    } else {
      // Multiple blockers - attacker's controller must order them and assign damage
      requiresPlayerInput = true;
      pendingDecisions.push({
        id: `decision_${Date.now()}_damage_${attacker.id}`,
        type: DecisionType.ORDER_BLOCKERS,
        playerId: attacker.controller,
        sourceId: attacker.id,
        sourceName: card?.name,
        description: `Order blockers for ${card?.name} and assign ${power} damage`,
        options: blockers.map(id => {
          const b = battlefield.find((p: BattlefieldPermanent) => p.id === id);
          return {
            id,
            label: (b?.card as any)?.name || 'Blocker',
          };
        }),
        mandatory: true,
        createdAt: Date.now(),
      });
    }
  }
  
  // Process blockers dealing damage to attackers
  const blockers = battlefield.filter((p: BattlefieldPermanent) => 
    p.blocking && p.blocking.length > 0
  );
  
  for (const blocker of blockers) {
    const card = blocker.card as any;
    const power = getCombatPower(blocker);
    const hasLifelink = hasCombatKeyword(blocker, 'lifelink');
    const hasDeathtouch = hasCombatKeyword(blocker, 'deathtouch');
    
    if (blocker.blocking && blocker.blocking.length > 0) {
      let remainingDamage = power;

      blocker.blocking.forEach((attackerId, index) => {
        if (remainingDamage <= 0) {
          return;
        }

        const attacker = battlefield.find((p: BattlefieldPermanent) => p.id === attackerId);
        if (!attacker) {
          return;
        }

        const lethalDamage = hasDeathtouch ? 1 : Math.max(1, getCombatToughness(attacker));
        const damageToAssign = index === blocker.blocking.length - 1
          ? remainingDamage
          : Math.min(remainingDamage, lethalDamage);

        assignments.push({
          sourceId: blocker.id,
          sourceName: card?.name,
          targetId: attackerId,
          targetType: 'creature',
          damage: damageToAssign,
          isLethal: damageToAssign >= lethalDamage,
          hasLifelink,
          hasDeathtouch,
        });

        remainingDamage -= damageToAssign;
      });
    }
  }
  
  return {
    damageAssignments: assignments,
    requiresPlayerInput,
    pendingDecisions,
  };
}

function getCombatPower(permanent: BattlefieldPermanent): number {
  const effectivePower = (permanent as any).effectivePower;
  if (typeof effectivePower === 'number') {
    return effectivePower;
  }

  return parseInt((permanent.card as any)?.power || '0', 10);
}

function hasCombatKeyword(permanent: BattlefieldPermanent, keyword: string): boolean {
  const lowerKeyword = keyword.toLowerCase();
  const oracleText = String((permanent.card as any)?.oracle_text || (permanent as any).oracle_text || '').toLowerCase();
  if (oracleText.includes(lowerKeyword)) {
    return true;
  }

  const grantedAbilities = Array.isArray((permanent as any).grantedAbilities)
    ? (permanent as any).grantedAbilities
    : [];
  return grantedAbilities.some((entry: unknown) => String(entry).toLowerCase().includes(lowerKeyword));
}

function getCombatToughness(permanent: BattlefieldPermanent): number {
  const effectiveToughness = (permanent as any).effectiveToughness;
  if (typeof effectiveToughness === 'number') {
    return effectiveToughness;
  }

  return parseInt((permanent.card as any)?.toughness || '1', 10);
}

/**
 * Combat damage assignment
 */
export interface CombatDamageAssignment {
  sourceId: string;
  sourceName?: string;
  targetId: string;
  targetType: 'creature' | 'player' | 'planeswalker';
  damage: number;
  isLethal: boolean;
  isFirstStrike?: boolean;
  hasLifelink?: boolean;
  hasTrample?: boolean;
  hasDeathtouch?: boolean;
}

/**
 * Apply combat damage assignments to game state
 */
export function applyCombatDamage(
  state: GameState,
  assignments: CombatDamageAssignment[]
): { state: GameState; log: string[] } {
  let updatedState = { ...state };
  const log: string[] = [];
  const appendDamageSourceId = (permanent: any, sourceId: string | undefined): any => {
    const normalizedSourceId = String(sourceId || '').trim();
    if (!normalizedSourceId) return permanent;

    const damageSourceIds = Array.isArray((permanent as any)?.damageSourceIds)
      ? (permanent as any).damageSourceIds
          .map((id: unknown) => String(id || '').trim())
          .filter(Boolean)
      : [];
    if (damageSourceIds.includes(normalizedSourceId)) return permanent;

    return {
      ...permanent,
      damageSourceIds: [...damageSourceIds, normalizedSourceId],
    };
  };
  
  for (const assignment of assignments) {
    const prevention = previewPreventedDamage(updatedState, assignment.damage, assignment.sourceId, {
      combatDamage: true,
      ...(assignment.targetType === 'player'
        ? { targetPlayerId: assignment.targetId as any }
        : { targetPermanentId: assignment.targetId }),
    });
    updatedState = prevention.state ?? updatedState;
    const finalDamage = prevention.remainingDamage;
    log.push(...prevention.log);
    if (finalDamage <= 0) {
      log.push(`${assignment.sourceName || assignment.sourceId} has all damage prevented`);
      continue;
    }

    if (assignment.targetType === 'player') {
      // Damage to player
      const updatedPlayers = updatedState.players.map(p => {
        if (p.id === assignment.targetId) {
          const newLife = (p.life || 0) - finalDamage;
          log.push(`${assignment.sourceName} deals ${finalDamage} damage to ${p.name} (${newLife} life)`);
          return { ...p, life: newLife };
        }
        return p;
      });
      updatedState = { ...updatedState, players: updatedPlayers };
    } else if (assignment.targetType === 'creature') {
      // Damage to creature - mark damage
      const updatedBattlefield = (updatedState.battlefield || []).map((p: BattlefieldPermanent) => {
        if (p.id === assignment.targetId) {
          const currentDamage = (p as any).damage || 0;
          const newDamage = currentDamage + finalDamage;
          log.push(`${assignment.sourceName} deals ${finalDamage} damage to ${(p.card as any)?.name}`);
          return appendDamageSourceId({ ...p, damage: newDamage } as any, assignment.sourceId) as any;
        }
        return p;
      });
      updatedState = { ...updatedState, battlefield: updatedBattlefield };
    } else if (assignment.targetType === 'planeswalker') {
      // Damage to planeswalker - remove loyalty
      const updatedBattlefield = (updatedState.battlefield || []).map((p: BattlefieldPermanent) => {
        if (p.id === assignment.targetId) {
          const currentLoyalty = p.loyalty || 0;
          const newLoyalty = Math.max(0, currentLoyalty - finalDamage);
          log.push(`${assignment.sourceName} deals ${finalDamage} damage to ${(p.card as any)?.name} (${newLoyalty} loyalty)`);
          return { ...p, loyalty: newLoyalty };
        }
        return p;
      });
      updatedState = { ...updatedState, battlefield: updatedBattlefield };
    }
    
    // Apply lifelink
    if (assignment.hasLifelink && finalDamage > 0) {
      const source = (updatedState.battlefield || []).find(
        (p: BattlefieldPermanent) => p.id === assignment.sourceId
      );
      if (source) {
        const updatedPlayers = updatedState.players.map(p => {
          if (p.id === source.controller) {
            const newLife = (p.life || 0) + finalDamage;
            log.push(`${p.name} gains ${finalDamage} life from lifelink`);
            return { ...p, life: newLife };
          }
          return p;
        });
        updatedState = { ...updatedState, players: updatedPlayers };
      }
    }
  }
  
  return { state: updatedState, log };
}
