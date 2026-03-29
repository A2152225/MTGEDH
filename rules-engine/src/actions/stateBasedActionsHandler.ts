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
  checkDeathtouchDamage,
  checkCreatureToughness,
  checkLethalDamage,
  checkPlaneswalkerLoyalty,
  checkCommanderDamage,
  checkLegendRule,
} from '../stateBasedActions';
import { applyStaticAbilitiesToBattlefield } from '../staticAbilities';
import { getAvailableShields, processDestructionWithRegeneration } from '../keywordAbilities/regeneration';
import {
  playerHasCantLoseEffect,
  opponentsHaveCantWinEffect,
  checkUpkeepWinConditions,
} from '../winEffectCards';
import { hasPermanentType } from '../permanentTypeUtils';

function permanentHasKeyword(perm: any, keyword: string): boolean {
  const lowerKeyword = String(keyword || '').trim().toLowerCase();
  if (!lowerKeyword) return false;

  const oracleText = String(perm?.card?.oracle_text || perm?.oracle_text || '').toLowerCase();
  if (oracleText.includes(lowerKeyword)) {
    return true;
  }

  const grantedAbilities = Array.isArray(perm?.grantedAbilities) ? perm.grantedAbilities : [];
  return grantedAbilities.some((entry: unknown) => String(entry || '').trim().toLowerCase() === lowerKeyword);
}

function creatureHasDeathtouchDamage(
  creature: any,
  permanentsById: ReadonlyMap<string, any>
): boolean {
  const damageSourceIds = Array.isArray(creature?.damageSourceIds)
    ? creature.damageSourceIds
        .map((id: unknown) => String(id || '').trim())
        .filter(Boolean)
    : [];
  if (damageSourceIds.length === 0) {
    return false;
  }

  return damageSourceIds.some((sourceId) => permanentHasKeyword(permanentsById.get(sourceId), 'deathtouch'));
}

function tryRegenerateStateBasedDestruction(
  battlefield: readonly any[],
  shields: readonly any[],
  permanentId: string
): {
  readonly wasRegenerated: boolean;
  readonly battlefield: readonly any[];
  readonly shields: readonly any[];
} {
  const originalPermanent = battlefield.find((entry: any) => String((entry as any)?.id || '').trim() === permanentId);
  const availableShields = getAvailableShields(permanentId, shields as any);
  if (!originalPermanent || availableShields.length === 0) {
    return {
      wasRegenerated: false,
      battlefield,
      shields,
    };
  }

  const originalDamage =
    Number(
      originalPermanent?.markedDamage ??
      originalPermanent?.damageMarked ??
      originalPermanent?.damage ??
      originalPermanent?.counters?.damage ??
      0
    ) || 0;
  const isInCombat = Boolean(
    originalPermanent?.attacking ||
    originalPermanent?.attackingPlayerId ||
    originalPermanent?.defendingPlayerId ||
    (Array.isArray(originalPermanent?.blocking) && originalPermanent.blocking.length > 0) ||
    (Array.isArray(originalPermanent?.blockedBy) && originalPermanent.blockedBy.length > 0)
  );
  const regeneration = processDestructionWithRegeneration(
    permanentId,
    shields as any,
    Boolean(originalPermanent?.tapped),
    originalDamage,
    isInCombat
  );

  if (!regeneration.wasRegenerated) {
    return {
      wasRegenerated: false,
      battlefield,
      shields: regeneration.updatedShields,
    };
  }

  return {
    wasRegenerated: true,
    battlefield: battlefield.map((entry: any) => (
      String((entry as any)?.id || '').trim() !== permanentId
        ? entry
        : {
            ...entry,
            tapped: regeneration.permanentTapped,
            markedDamage: 0,
            damageMarked: 0,
            damage: 0,
            counters: {
              ...((entry?.counters || {}) as Record<string, number>),
              damage: 0,
            },
            attacking: undefined,
            attackingPlayerId: undefined,
            defendingPlayerId: undefined,
            blocking: undefined,
            blockedBy: undefined,
          }
    )),
    shields: regeneration.updatedShields,
  };
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
  if (creatureDeaths.deaths.length > 0 || creatureDeaths.actions.length > 0) {
    currentState = creatureDeaths.state;
    actions.push(...creatureDeaths.actions);
    if (creatureDeaths.deaths.length > 0) {
      checkAgain = true;
    }
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
  const processedPermanentsById = new Map(
    processedBattlefield.map((perm: any) => [String((perm as any)?.id || '').trim(), perm] as const)
  );
  const creatureDeaths: string[] = [];
  const actions: string[] = [];
  let updatedBattlefield = [...allPermanents];
  let nextShields = Array.isArray((state as any).regenerationShields)
    ? [...((state as any).regenerationShields as any[])]
    : [];
  
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
    const shouldTrustEffectiveToughness = hasPrintedToughness || hasPowerToughnessModifiers;
    const printedToughnessValue =
      (shouldTrustEffectiveToughness ? (perm as any).effectiveToughness : undefined) ??
      (perm as any).baseToughness ??
      (perm as any).toughness ??
      perm.card?.toughness;
    const baseToughness =
      typeof printedToughnessValue === 'number'
        ? printedToughnessValue
        : (typeof printedToughnessValue === 'string' && printedToughnessValue.trim().length > 0
            ? parseInt(printedToughnessValue, 10)
            : undefined);
    const toughness = shouldTrustEffectiveToughness && typeof (perm as any).effectiveToughness === 'number'
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
      const regeneration = tryRegenerateStateBasedDestruction(updatedBattlefield, nextShields, String(perm.id || '').trim());
      nextShields = [...regeneration.shields];
      if (regeneration.wasRegenerated) {
        updatedBattlefield = [...regeneration.battlefield];
          actions.push(`${perm.card.name} regenerates instead of dying`);
          continue;
      }

      creatureDeaths.push(perm.id);
      actions.push(`${perm.card.name} dies (lethal damage)`);
      continue;
    }

    const deathtouchCheck = checkDeathtouchDamage(
      perm.id,
      toughness,
      creatureHasDeathtouchDamage(perm, processedPermanentsById)
    );
    if (deathtouchCheck) {
      const regeneration = tryRegenerateStateBasedDestruction(updatedBattlefield, nextShields, String(perm.id || '').trim());
      nextShields = [...regeneration.shields];
      if (regeneration.wasRegenerated) {
        updatedBattlefield = [...regeneration.battlefield];
        actions.push(`${perm.card.name} regenerates instead of dying`);
        continue;
      }

      creatureDeaths.push(perm.id);
      actions.push(`${perm.card.name} dies (deathtouch damage)`);
    }
  }
  
  if (creatureDeaths.length === 0) {
    if (actions.length === 0 && nextShields === (state as any).regenerationShields && updatedBattlefield === allPermanents) {
      return { state, deaths: [], actions: [] };
    }
    return {
      state: {
        ...(state as any),
        battlefield: updatedBattlefield,
        regenerationShields: nextShields,
      } as GameState,
      deaths: [],
      actions,
    };
  }
  
  // Move dead creatures to graveyard
  const deadPermanents = updatedBattlefield.filter((p: any) => creatureDeaths.includes(p.id));
  const updatedState = {
    ...(state as any),
    battlefield: updatedBattlefield.filter((p: any) => !creatureDeaths.includes(p.id)),
    regenerationShields: nextShields,
    players: state.players.map(player => ({
      ...player,
      graveyard: [
        ...(player.graveyard || []),
        // Find dead creatures from centralized battlefield that this player owned
        ...deadPermanents.filter((p: any) => 
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
