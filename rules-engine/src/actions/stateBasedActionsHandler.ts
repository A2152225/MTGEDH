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
import { applyStaticAbilitiesToBattlefield } from '../staticAbilities';
import {
  playerHasCantLoseEffect,
  opponentsHaveCantWinEffect,
  checkUpkeepWinConditions,
} from '../winEffectCards';

function hasPermanentType(perm: any, type: string): boolean {
  const targetType = type.toLowerCase();
  const effectiveTypes = Array.isArray(perm?.effectiveTypes) ? perm.effectiveTypes : [];
  if (effectiveTypes.some((entry: unknown) => String(entry).toLowerCase() === targetType)) {
    return true;
  }

  const grantedTypes = Array.isArray(perm?.grantedTypes) ? perm.grantedTypes : [];
  if (grantedTypes.some((entry: unknown) => String(entry).toLowerCase() === targetType)) {
    return true;
  }

  const cardType = String(perm?.cardType || '').toLowerCase();
  if (cardType.includes(targetType)) {
    return true;
  }

  const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
  return typeLine.includes(targetType);
}

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
  const cantLoseBattlefield = (currentState.battlefield || []) as any;
  
  // Check each player
  for (const player of currentState.players) {
    const temporaryWinLossEffects = ((currentState as any).winLossEffects || []) as any;
    const cantLose = playerHasCantLoseEffect(player.id, cantLoseBattlefield, currentState.players as any, temporaryWinLossEffects);

    // Rule 704.5a: Zero or less life
    const lifeCheck = checkPlayerLife(player.id, player.life || 0);
    if (lifeCheck) {
      if (cantLose.hasCantLose) {
        actions.push(`${player.id} would lose (0 life) but is protected by ${cantLose.source}`);
      } else {
        actions.push(`${player.id} loses (0 life)`);
        playerLost = player.id;
        checkAgain = true;
      }
    }
    
    // Rule 704.5c: Poison counters
    const poisonCheck = checkPoisonCounters(player.id, player.counters?.poison || 0);
    if (poisonCheck) {
      if (cantLose.hasCantLose) {
        actions.push(`${player.id} would lose (10+ poison) but is protected by ${cantLose.source}`);
      } else {
        actions.push(`${player.id} loses (10+ poison)`);
        playerLost = player.id;
        checkAgain = true;
      }
    }
    
    // Rule 704.6c: Commander damage (21+)
    if (player.commanderDamage) {
      const cmdDmg = new Map(Object.entries(player.commanderDamage));
      const commanderCheck = checkCommanderDamage(player.id, cmdDmg);
      if (commanderCheck) {
        if (cantLose.hasCantLose) {
          actions.push(`${player.id} would lose (21+ commander damage) but is protected by ${cantLose.source}`);
        } else {
          actions.push(`${player.id} loses (21+ commander damage)`);
          playerLost = player.id;
          checkAgain = true;
        }
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
  const processedBattlefield = applyStaticAbilitiesToBattlefield(allPermanents as any[]);
  const creatureDeaths: string[] = [];
  const actions: string[] = [];
  
  for (const perm of processedBattlefield) {
    if (!hasPermanentType(perm, 'creature')) continue;

    const hasPrintedToughness =
      (perm as any).baseToughness !== undefined ||
      (perm as any).toughness !== undefined ||
      (typeof perm.card?.toughness === 'string' && perm.card.toughness.trim().length > 0) ||
      typeof perm.card?.toughness === 'number';
    const hasPowerToughnessModifiers =
      ((perm as any).counters?.['+1/+1'] || 0) !== 0 ||
      ((perm as any).counters?.['-1/-1'] || 0) !== 0 ||
      (Array.isArray((perm as any).modifiers) &&
        (perm as any).modifiers.some((mod: any) =>
          mod?.type === 'powerToughness' ||
          mod?.type === 'POWER_TOUGHNESS' ||
          mod?.type === 'setPowerToughness'
        ));
    const printedToughnessValue =
      (hasPrintedToughness || hasPowerToughnessModifiers ? (perm as any).effectiveToughness : undefined) ??
      (perm as any).baseToughness ??
      (perm as any).toughness ??
      perm.card?.toughness;
    const baseToughness =
      typeof printedToughnessValue === 'number'
        ? printedToughnessValue
        : (typeof printedToughnessValue === 'string' && printedToughnessValue.trim().length > 0
            ? parseInt(printedToughnessValue, 10)
            : undefined);
    const toughness = typeof (perm as any).effectiveToughness === 'number'
      ? (perm as any).effectiveToughness
      : baseToughness;
    if (typeof toughness !== 'number' || Number.isNaN(toughness)) continue;
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
  const processedBattlefield = applyStaticAbilitiesToBattlefield(allPermanents as any[]);
  const deaths: string[] = [];
  const actions: string[] = [];
  
  for (const perm of processedBattlefield) {
    if (!hasPermanentType(perm, 'planeswalker')) continue;
    
    const loyalty = perm.counters?.loyalty || 0;
    const loyaltyCheck = checkPlaneswalkerLoyalty(perm.id, loyalty);
    if (loyaltyCheck) {
      deaths.push(perm.id);
      actions.push(`${perm.card.name} dies (0 loyalty)`);
    }
  }

  if (deaths.length === 0) {
    return { state, deaths, actions };
  }

  const updatedState = {
    ...state,
    battlefield: allPermanents.filter((p: any) => !deaths.includes(p.id)),
    players: state.players.map(player => ({
      ...player,
      graveyard: [
        ...(player.graveyard || []),
        ...allPermanents.filter((p: any) =>
          deaths.includes(p.id) &&
          (p.owner === player.id || p.controller === player.id)
        ),
      ],
    })),
  };
  
  return { state: updatedState, deaths, actions };
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
  if ((state as any).winner) {
    return { winner: (state as any).winner, reason: String((state as any).winReason || 'Game effect') };
  }

  const activePlayer = state.players[(state.activePlayerIndex || 0)] as any;
  if (String(state.step || '').toLowerCase() === 'upkeep' && activePlayer?.id) {
    const librarySize = (activePlayer.library || []).length;
    const handSize = (activePlayer.hand || []).length;
    const graveyardCreatureCount = (activePlayer.graveyard || []).filter((card: any) =>
      String(card?.type_line || '').toLowerCase().includes('creature')
    ).length;
    const upkeepWinCheck = checkUpkeepWinConditions(
      activePlayer.id,
      librarySize,
      handSize,
      graveyardCreatureCount,
      (state.battlefield || []) as any,
      state.players as any,
      ((state as any).winLossEffects || []) as any,
    );
    if (upkeepWinCheck.playerWins && upkeepWinCheck.winningPlayerId) {
      return { winner: upkeepWinCheck.winningPlayerId, reason: upkeepWinCheck.winReason };
    }
  }

  const activePlayers = state.players.filter(p => !(p as any).hasLost);
  
  if (activePlayers.length === 1) {
    const winnerId = activePlayers[0].id;
    const cantWin = opponentsHaveCantWinEffect(winnerId as any, (state.battlefield || []) as any, state.players as any, ((state as any).winLossEffects || []) as any);
    if (cantWin.hasCantWin) {
      return { reason: `${winnerId} cannot win because of ${cantWin.source}` };
    }

    return { winner: winnerId, reason: 'Last player standing' };
  }
  
  if (activePlayers.length === 0) {
    return { reason: 'Draw - no players remaining' };
  }
  
  return {};
}
