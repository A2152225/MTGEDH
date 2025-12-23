/**
 * actions/stateBasedActionsHandler.ts
 * 
 * Processes state-based actions (Rule 704).
 * SBAs are checked before any player receives priority.
 */

import type { GameState } from '../../../shared/src';
import {
  checkPlayerLife,
  checkPoisonCounters,
  checkCreatureToughness,
  checkLethalDamage,
  checkPlaneswalkerLoyalty,
  checkCommanderDamage,
  checkLegendRule,
} from '../stateBasedActions';

export interface SBAResult {
  state: GameState;
  actions: string[];
  playerLost?: string;
  checkAgain: boolean;
}

/**
 * Check and perform all state-based actions
 */
export function performStateBasedActions(state: GameState): SBAResult {
  const actions: string[] = [];
  let currentState = { ...state };
  let playerLost: string | undefined;
  let checkAgain = false;
  
  // Check each player
  for (const player of currentState.players) {
    // Rule 704.5a: Zero or less life
    const lifeCheck = checkPlayerLife(player.id, player.life || 0);
    if (lifeCheck) {
      actions.push(`${player.id} loses (0 life)`);
      playerLost = player.id;
      checkAgain = true;
    }
    
    // Rule 704.5c: Poison counters
    const poisonCheck = checkPoisonCounters(player.id, player.counters?.poison || 0);
    if (poisonCheck) {
      actions.push(`${player.id} loses (10+ poison)`);
      playerLost = player.id;
      checkAgain = true;
    }
    
    // Rule 704.6c: Commander damage (21+)
    if (player.commanderDamage) {
      const cmdDmg = new Map(Object.entries(player.commanderDamage));
      const commanderCheck = checkCommanderDamage(player.id, cmdDmg);
      if (commanderCheck) {
        actions.push(`${player.id} loses (21+ commander damage)`);
        playerLost = player.id;
        checkAgain = true;
      }
    }
  }
  
  // Check creatures for lethal damage/zero toughness
  const creatureDeaths = checkCreatureDeaths(currentState);
  if (creatureDeaths.deaths.length > 0) {
    currentState = creatureDeaths.state;
    actions.push(...creatureDeaths.actions);
    checkAgain = true;
  }
  
  // Check planeswalkers for zero loyalty
  const planeswalkerDeaths = checkPlaneswalkerDeaths(currentState);
  if (planeswalkerDeaths.deaths.length > 0) {
    currentState = planeswalkerDeaths.state;
    actions.push(...planeswalkerDeaths.actions);
    checkAgain = true;
  }
  
  // Check legend rule
  const legendCheck = checkLegendRuleViolations(currentState);
  if (legendCheck.violations.length > 0) {
    actions.push('Legend rule: duplicate legendaries');
    checkAgain = true;
  }
  
  return { state: currentState, actions, playerLost, checkAgain };
}

/**
 * Check creatures for death conditions
 */
function checkCreatureDeaths(state: GameState): {
  state: GameState;
  deaths: string[];
  actions: string[];
} {
  const allPermanents = state.battlefield || [];
  const creatureDeaths: string[] = [];
  const actions: string[] = [];
  
  for (const perm of allPermanents) {
    if (!perm.card?.type_line?.toLowerCase().includes('creature')) continue;
    
    const baseToughness = parseInt(String(perm.card.toughness || '0'), 10);
    const toughnessModifier = perm.counters?.['toughness'] || 0;
    const toughness = baseToughness + toughnessModifier;
    const damage = perm.counters?.damage || 0;
    
    // Zero toughness
    const toughnessCheck = checkCreatureToughness(perm.id, toughness);
    if (toughnessCheck) {
      creatureDeaths.push(perm.id);
      actions.push(`${perm.card.name} dies (0 toughness)`);
      continue;
    }
    
    // Lethal damage
    const lethalCheck = checkLethalDamage(perm.id, toughness, damage);
    if (lethalCheck) {
      creatureDeaths.push(perm.id);
      actions.push(`${perm.card.name} dies (lethal damage)`);
    }
  }
  
  if (creatureDeaths.length === 0) {
    return { state, deaths: [], actions: [] };
  }
  
  // Move dead creatures to graveyard
  const updatedState = {
    ...state,
    battlefield: allPermanents.filter((p: any) => !creatureDeaths.includes(p.id)),
    players: state.players.map(player => ({
      ...player,
      graveyard: [
        ...(player.graveyard || []),
        // Find dead creatures from centralized battlefield that this player owned
        ...allPermanents.filter((p: any) => 
          creatureDeaths.includes(p.id) && 
          (p.owner === player.id || p.controller === player.id)
        ),
      ],
    })),
  };
  
  return { state: updatedState, deaths: creatureDeaths, actions };
}

/**
 * Check planeswalkers for zero loyalty
 */
function checkPlaneswalkerDeaths(state: GameState): {
  state: GameState;
  deaths: string[];
  actions: string[];
} {
  const allPermanents = state.battlefield || [];
  const deaths: string[] = [];
  const actions: string[] = [];
  
  for (const perm of allPermanents) {
    if (!perm.card?.type_line?.toLowerCase().includes('planeswalker')) continue;
    
    const loyalty = perm.counters?.loyalty || 0;
    const loyaltyCheck = checkPlaneswalkerLoyalty(perm.id, loyalty);
    if (loyaltyCheck) {
      deaths.push(perm.id);
      actions.push(`${perm.card.name} dies (0 loyalty)`);
    }
  }
  
  return { state, deaths, actions };
}

/**
 * Check for legend rule violations
 */
function checkLegendRuleViolations(state: GameState): {
  violations: string[];
} {
  const allPermanents = state.battlefield || [];
  const legendaries = allPermanents
    .filter((p: any) => p.card?.type_line?.toLowerCase().includes('legendary'))
    .map((p: any) => ({
      id: p.id,
      name: p.card.name,
      controllerId: p.controller || p.controllerId,
    }));
  
  const legendCheck = checkLegendRule(legendaries);
  return { violations: legendCheck ? legendCheck.affectedObjectIds as string[] : [] };
}

/**
 * Check for win conditions
 */
export function checkWinConditions(state: GameState): {
  winner?: string;
  reason?: string;
} {
  const activePlayers = state.players.filter(p => !(p as any).hasLost);
  
  if (activePlayers.length === 1) {
    return { winner: activePlayers[0].id, reason: 'Last player standing' };
  }
  
  if (activePlayers.length === 0) {
    return { reason: 'Draw - no players remaining' };
  }
  
  return {};
}
