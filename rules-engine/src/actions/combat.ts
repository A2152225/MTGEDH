/**
 * actions/combat.ts
 * 
 * Combat-related action handlers.
 * Handles declaring attackers, blockers, and dealing combat damage.
 */

import type { GameState } from '../../../shared/src';
import type { EngineResult, ActionContext, BaseAction } from '../core/types';
import { RulesEngineEvent } from '../core/events';

export interface AttackerDeclaration {
  readonly creatureId: string;
  readonly defendingPlayerId: string;
}

export interface BlockerDeclaration {
  readonly blockerId: string;
  readonly attackerId: string;
  readonly damageOrder?: number;
}

export interface DeclareAttackersAction extends BaseAction {
  readonly type: 'declareAttackers';
  readonly attackers: AttackerDeclaration[];
}

export interface DeclareBlockersAction extends BaseAction {
  readonly type: 'declareBlockers';
  readonly blockers: BlockerDeclaration[];
}

export interface CombatDamageAssignment {
  readonly attackerId: string;
  readonly damage: number;
  readonly defendingPlayerId?: string;
  readonly blockedBy?: Array<{ blockerId: string; damageAssigned: number }>;
  readonly creature?: any;
}

export interface DealCombatDamageAction extends BaseAction {
  readonly type: 'dealCombatDamage';
  readonly attackers: CombatDamageAssignment[];
}

/**
 * Validate declare attackers action
 */
export function validateDeclareAttackers(
  state: GameState,
  action: DeclareAttackersAction
): { legal: boolean; reason?: string } {
  // Check if it's the declare attackers step
  if (state.step !== 'declareAttackers' && state.step !== 'DECLARE_ATTACKERS') {
    return { legal: false, reason: 'Not in declare attackers step' };
  }
  
  // Check if player is active player
  const activePlayer = state.players[state.activePlayerIndex || 0];
  if (activePlayer?.id !== action.playerId) {
    return { legal: false, reason: 'Only active player can declare attackers' };
  }
  
  // Validate each attacker
  for (const attacker of action.attackers) {
    const creature = state.battlefield?.find(
      (p: any) => p.id === attacker.creatureId && p.controller === action.playerId
    );
    
    if (!creature) {
      return { legal: false, reason: `Creature ${attacker.creatureId} not found on battlefield` };
    }
    
    // Check if creature can attack (not tapped, has haste or was on battlefield since start of turn)
    if ((creature as any).tapped) {
      return { legal: false, reason: 'Cannot attack with tapped creature' };
    }
    
    // Check for defender keyword
    const typeLine = (creature as any).card?.type_line?.toLowerCase() || '';
    const oracleText = (creature as any).card?.oracle_text?.toLowerCase() || '';
    if (typeLine.includes('defender') || oracleText.includes('defender')) {
      return { legal: false, reason: 'Creatures with defender cannot attack' };
    }
  }
  
  return { legal: true };
}

/**
 * Execute declare attackers action
 */
export function executeDeclareAttackers(
  gameId: string,
  action: DeclareAttackersAction,
  context: ActionContext
): EngineResult<GameState> {
  const state = context.getState(gameId);
  
  if (!state) {
    return { next: state!, log: ['Game not found'] };
  }
  
  // Tap all attacking creatures
  const updatedBattlefield = (state.battlefield || []).map((perm: any) => {
    const isAttacker = action.attackers.some(a => a.creatureId === perm.id);
    if (isAttacker) {
      return { ...perm, tapped: true };
    }
    return perm;
  });
  
  // Build combat state
  const combat = {
    attackers: action.attackers.map(a => ({
      cardId: a.creatureId,
      defendingPlayerId: a.defendingPlayerId,
      blocked: false,
      blockedBy: [],
    })),
    blockers: [],
    declared: true,
  };
  
  const nextState: GameState = {
    ...state,
    battlefield: updatedBattlefield,
    combat,
  };
  
  context.emit({
    type: RulesEngineEvent.ATTACKERS_DECLARED,
    timestamp: Date.now(),
    gameId,
    data: { 
      attackers: action.attackers, 
      attackerCount: action.attackers.length 
    },
  });
  
  return {
    next: nextState,
    log: [`Declared ${action.attackers.length} attackers`],
  };
}

/**
 * Validate declare blockers action
 */
export function validateDeclareBlockers(
  state: GameState,
  action: DeclareBlockersAction
): { legal: boolean; reason?: string } {
  // Check if it's the declare blockers step
  if (state.step !== 'declareBlockers' && state.step !== 'DECLARE_BLOCKERS') {
    return { legal: false, reason: 'Not in declare blockers step' };
  }
  
  // Validate each blocker
  for (const blocker of action.blockers) {
    const creature = state.battlefield?.find(
      (p: any) => p.id === blocker.blockerId && p.controller === action.playerId
    );
    
    if (!creature) {
      return { legal: false, reason: `Creature ${blocker.blockerId} not found on battlefield` };
    }
    
    // Check if creature can block (not tapped)
    if ((creature as any).tapped) {
      return { legal: false, reason: 'Cannot block with tapped creature' };
    }
    
    // Check if attacker exists
    const attackerExists = state.combat?.attackers?.some(
      (a: any) => a.cardId === blocker.attackerId
    );
    if (!attackerExists) {
      return { legal: false, reason: `Attacker ${blocker.attackerId} not found` };
    }
  }
  
  return { legal: true };
}

/**
 * Execute declare blockers action
 */
export function executeDeclareBlockers(
  gameId: string,
  action: DeclareBlockersAction,
  context: ActionContext
): EngineResult<GameState> {
  const state = context.getState(gameId);
  
  if (!state) {
    return { next: state!, log: ['Game not found'] };
  }
  
  // Update combat state with blockers
  const attackers = (state.combat?.attackers || []).map((a: any) => {
    const blockers = action.blockers.filter(b => b.attackerId === a.cardId);
    return {
      ...a,
      blocked: blockers.length > 0,
      blockedBy: blockers.map(b => b.blockerId),
    };
  });
  
  const combat = {
    ...state.combat,
    attackers,
    blockers: action.blockers.map(b => ({
      cardId: b.blockerId,
      blocking: b.attackerId,
      damageAssignment: b.damageOrder,
    })),
    declared: true,
  };
  
  const nextState: GameState = {
    ...state,
    combat,
  };
  
  context.emit({
    type: RulesEngineEvent.BLOCKERS_DECLARED,
    timestamp: Date.now(),
    gameId,
    data: { 
      blockers: action.blockers, 
      blockerCount: action.blockers.length 
    },
  });
  
  return {
    next: nextState,
    log: [`Declared ${action.blockers.length} blockers`],
  };
}

/**
 * Execute combat damage
 */
export function executeCombatDamage(
  gameId: string,
  action: DealCombatDamageAction,
  context: ActionContext
): EngineResult<GameState> {
  const state = context.getState(gameId);
  
  if (!state) {
    return { next: state!, log: ['Game not found'] };
  }
  
  let currentState = { ...state };
  const logs: string[] = [];
  
  for (const attacker of action.attackers) {
    const creature = attacker.creature;
    const damage = attacker.damage || creature?.power || 0;
    
    if (attacker.blockedBy && attacker.blockedBy.length > 0) {
      // Creature is blocked - deal damage to blockers
      for (const block of attacker.blockedBy) {
        const damageToBlocker = block.damageAssigned || damage;
        
        // Find blocker and assign damage
        const blocker = currentState.battlefield?.find((p: any) => p.id === block.blockerId);
        if (blocker) {
          // Add damage counter (simplified - real implementation needs damage tracking)
          const updatedBattlefield = (currentState.battlefield || []).map((p: any) => {
            if (p.id === block.blockerId) {
              return {
                ...p,
                counters: {
                  ...p.counters,
                  damage: (p.counters?.damage || 0) + damageToBlocker,
                },
              };
            }
            return p;
          });
          
          currentState = { ...currentState, battlefield: updatedBattlefield };
          logs.push(`${creature?.name || 'Creature'} deals ${damageToBlocker} damage to ${blocker?.card?.name || 'blocker'}`);
        }
      }
    } else if (attacker.defendingPlayerId) {
      // Unblocked - deal damage to defending player
      const defender = currentState.players.find(p => p.id === attacker.defendingPlayerId);
      
      if (defender) {
        const newLife = (defender.life || 40) - damage;
        
        currentState = {
          ...currentState,
          players: currentState.players.map(p =>
            p.id === attacker.defendingPlayerId
              ? { ...p, life: newLife }
              : p
          ),
        };
        
        logs.push(`${creature?.name || 'Creature'} deals ${damage} combat damage to ${attacker.defendingPlayerId}`);
        
        // Handle commander damage
        if (creature?.isCommander) {
          const commanderDamage = defender.commanderDamage || {};
          const commanderId = creature.id;
          const totalCommanderDamage = (commanderDamage[commanderId] || 0) + damage;
          
          currentState = {
            ...currentState,
            players: currentState.players.map(p =>
              p.id === attacker.defendingPlayerId
                ? { 
                    ...p, 
                    commanderDamage: { 
                      ...commanderDamage, 
                      [commanderId]: totalCommanderDamage 
                    } 
                  }
                : p
            ),
          };
          
          logs.push(`Commander damage: ${totalCommanderDamage}/21 from ${creature.name}`);
        }
      }
    }
  }
  
  context.emit({
    type: RulesEngineEvent.DAMAGE_DEALT,
    timestamp: Date.now(),
    gameId,
    data: { attackers: action.attackers, logs },
  });
  
  return {
    next: currentState,
    log: logs,
  };
}
