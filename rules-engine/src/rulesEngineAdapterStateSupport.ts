import type { GameState } from '../../shared/src';
import { buildZoneObjectWithRetainedCounters } from '../../shared/src/zoneRetainedCounters';
import { getLeaveBattlefieldDestination } from '../../shared/src/leaveBattlefieldReplacement';
import type { EngineResult } from './index';
import { applyStaticAbilitiesToBattlefield } from './staticAbilities';
import { GameEndReason, WinCondition } from './types/gameFlow';
import { opponentsHaveCantWinEffect } from './winEffectCards';
import { RulesEngineEvent, type RulesEvent } from './core/events';

type EmitRulesEvent = (event: RulesEvent) => void;
type PersistGameState = (gameId: string, state: GameState) => void;

export function hasPermanentType(perm: any, type: string): boolean {
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

export function movePermanentToGraveyard(state: GameState, permanent: any): GameState {
  const ownerId = permanent.controller || permanent.controllerId || permanent.owner;
  const destination = getLeaveBattlefieldDestination(permanent, 'graveyard');

  const updatedBattlefield = (state.battlefield || []).filter(
    (entry: any) => entry.id !== permanent.id
  );

  const updatedPlayers = state.players.map(player => {
    if (player.id === ownerId) {
      const zoneObject = buildZoneObjectWithRetainedCounters(permanent.card || permanent, permanent, destination);
      return {
        ...player,
        ...(destination === 'graveyard'
          ? { graveyard: [...(player.graveyard || []), zoneObject] }
          : { exile: [...((player as any).exile || []), zoneObject] }),
      };
    }

    return player;
  });

  return {
    ...state,
    battlefield: updatedBattlefield,
    players: updatedPlayers,
  };
}

export function checkWinConditionsForState(args: {
  gameId: string;
  state: GameState;
  emit: EmitRulesEvent;
  persistState: PersistGameState;
}): EngineResult<GameState> {
  const { gameId, state, emit, persistState } = args;
  const activePlayers = state.players.filter(p => !p.hasLost);

  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
    const cantWin = opponentsHaveCantWinEffect(
      winner.id as any,
      battlefield as any,
      state.players as any,
      ((state as any).winLossEffects || []) as any,
    );
    if (cantWin.hasCantWin) {
      return {
        next: state,
        log: [`${winner.id} cannot win because of ${cantWin.source}`],
      };
    }

    const nextState = { ...state, status: 'finished' as any, winner: winner.id };
    persistState(gameId, nextState);

    emit({
      type: RulesEngineEvent.PLAYER_WON,
      timestamp: Date.now(),
      gameId,
      data: { playerId: winner.id, reason: WinCondition.OPPONENTS_LEFT },
    });

    emit({
      type: RulesEngineEvent.GAME_ENDED,
      timestamp: Date.now(),
      gameId,
      data: { winner: winner.id, reason: GameEndReason.PLAYER_WIN },
    });

    return {
      next: nextState,
      log: [`${winner.id} wins the game!`],
    };
  }

  if (activePlayers.length === 0) {
    const nextState = { ...state, status: 'finished' as any };
    persistState(gameId, nextState);

    emit({
      type: RulesEngineEvent.GAME_ENDED,
      timestamp: Date.now(),
      gameId,
      data: { reason: GameEndReason.DRAW },
    });

    return {
      next: nextState,
      log: ['Game is a draw - all players lost'],
    };
  }

  return { next: state };
}

export function payLifeActionForState(args: {
  gameId: string;
  state: GameState;
  action: any;
  emit: EmitRulesEvent;
}): EngineResult<GameState> {
  const { gameId, state, action, emit } = args;
  const player = state.players.find(entry => entry.id === action.playerId);

  if (!player) {
    return { next: state, log: ['Player not found'] };
  }

  const amount = action.amount || 1;
  const newLife = (player.life || 0) - amount;

  const updatedPlayers = state.players.map(entry =>
    entry.id === action.playerId
      ? { ...entry, life: newLife }
      : entry
  );

  const nextState: GameState = {
    ...state,
    players: updatedPlayers,
  };

  emit({
    type: RulesEngineEvent.LIFE_PAID,
    timestamp: Date.now(),
    gameId,
    data: { playerId: action.playerId, amount, newLife },
  });

  return {
    next: nextState,
    log: [`${action.playerId} paid ${amount} life`],
  };
}

export function checkCreatureDeathsForState(args: {
  gameId: string;
  state: GameState;
  emit: EmitRulesEvent;
}): { state: GameState; deaths: string[]; logs: string[] } {
  const { gameId, state, emit } = args;
  const deaths: string[] = [];
  const logs: string[] = [];
  let updatedState = state;

  const allPermanents: any[] = [];
  if (state.battlefield) {
    allPermanents.push(...(state.battlefield as any[]));
  }

  const processedPermanents = applyStaticAbilitiesToBattlefield(allPermanents as any[]);

  for (const perm of processedPermanents) {
    if (!hasPermanentType(perm, 'creature')) continue;

    const hasPrintedToughness =
      perm.baseToughness !== undefined ||
      (perm as any).toughness !== undefined ||
      (typeof perm.card?.toughness === 'string' && perm.card.toughness.trim().length > 0) ||
      typeof perm.card?.toughness === 'number';
    const hasPowerToughnessModifiers =
      (perm.counters?.['+1/+1'] || 0) !== 0 ||
      (perm.counters?.['-1/-1'] || 0) !== 0 ||
      (Array.isArray(perm.modifiers) &&
        perm.modifiers.some((mod: any) =>
          mod?.type === 'powerToughness' ||
          mod?.type === 'POWER_TOUGHNESS' ||
          mod?.type === 'setPowerToughness'
        ));
    const printedToughnessValue =
      (hasPrintedToughness || hasPowerToughnessModifiers ? perm.effectiveToughness : undefined) ??
      perm.baseToughness ??
      (perm as any).toughness ??
      perm.card?.toughness;
    let toughness =
      typeof perm.effectiveToughness === 'number'
        ? perm.effectiveToughness
        : (typeof printedToughnessValue === 'number'
            ? printedToughnessValue
            : (typeof printedToughnessValue === 'string' && printedToughnessValue.trim().length > 0
                ? parseInt(printedToughnessValue, 10)
                : NaN));
    if (Number.isNaN(toughness)) continue;
    const plusCounters = perm.counters?.['+1/+1'] || 0;
    const minusCounters = perm.counters?.['-1/-1'] || 0;
    const damageMarked = perm.counters?.damage || perm.damageMarked || 0;

    if (typeof perm.effectiveToughness !== 'number') {
      toughness += plusCounters - minusCounters;
    }

    if (toughness <= 0) {
      deaths.push(perm.id);
      logs.push(`${perm.card?.name || 'Creature'} dies (0 or less toughness)`);
      updatedState = movePermanentToGraveyard(updatedState, perm);

      emit({
        type: RulesEngineEvent.CREATURE_DIED,
        timestamp: Date.now(),
        gameId,
        data: {
          permanentId: perm.id,
          name: perm.card?.name,
          reason: 'zero_toughness',
        },
      });
      continue;
    }

    if (damageMarked >= toughness) {
      deaths.push(perm.id);
      logs.push(`${perm.card?.name || 'Creature'} dies (lethal damage)`);
      updatedState = movePermanentToGraveyard(updatedState, perm);

      emit({
        type: RulesEngineEvent.CREATURE_DIED,
        timestamp: Date.now(),
        gameId,
        data: {
          permanentId: perm.id,
          name: perm.card?.name,
          reason: 'lethal_damage',
        },
      });
    }
  }

  return { state: updatedState, deaths, logs };
}

export function checkPlaneswalkerDeathsForState(args: {
  gameId: string;
  state: GameState;
  emit: EmitRulesEvent;
}): { state: GameState; deaths: string[]; logs: string[] } {
  const { gameId, state, emit } = args;
  const deaths: string[] = [];
  const logs: string[] = [];
  let updatedState = state;

  const allPermanents: any[] = [];
  if (state.battlefield) {
    allPermanents.push(...(state.battlefield as any[]));
  }

  const processedPermanents = applyStaticAbilitiesToBattlefield(allPermanents as any[]);

  for (const perm of processedPermanents) {
    if (!hasPermanentType(perm, 'planeswalker')) continue;

    const loyalty = perm.counters?.loyalty || perm.loyalty || 0;

    if (loyalty <= 0) {
      deaths.push(perm.id);
      logs.push(`${perm.card?.name || 'Planeswalker'} dies (0 loyalty)`);
      updatedState = movePermanentToGraveyard(updatedState, perm);

      emit({
        type: RulesEngineEvent.PERMANENT_LEFT_BATTLEFIELD,
        timestamp: Date.now(),
        gameId,
        data: {
          permanentId: perm.id,
          name: perm.card?.name,
          reason: 'zero_loyalty',
        },
      });
    }
  }

  return { state: updatedState, deaths, logs };
}

export function checkLegendRuleForState(args: {
  gameId: string;
  state: GameState;
  emit: EmitRulesEvent;
}): { state: GameState; sacrificed: string[]; logs: string[] } {
  const { gameId, state, emit } = args;
  const sacrificed: string[] = [];
  const logs: string[] = [];
  let updatedState = state;
  const legendsByControllerAndName = new Map<string, any[]>();
  const battlefield = state.battlefield || [];

  for (const player of state.players) {
    const playerPerms = battlefield.filter((perm: any) => perm.controller === player.id);
    for (const perm of playerPerms) {
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      const superTypes = typeLine.split('—')[0];

      if (superTypes.includes('legendary')) {
        const name = perm.card?.name || 'Unknown';
        const key = `${player.id}:${name}`;

        const existing = legendsByControllerAndName.get(key) || [];
        existing.push(perm);
        legendsByControllerAndName.set(key, existing);
      }
    }
  }

  for (const legends of legendsByControllerAndName.values()) {
    if (legends.length <= 1) continue;

    const toSacrifice = legends.slice(0, -1);
    for (const perm of toSacrifice) {
      sacrificed.push(perm.id);
      logs.push(`${perm.card?.name || 'Legendary'} put into graveyard (legend rule)`);
      updatedState = movePermanentToGraveyard(updatedState, perm);

      emit({
        type: RulesEngineEvent.PERMANENT_LEFT_BATTLEFIELD,
        timestamp: Date.now(),
        gameId,
        data: {
          permanentId: perm.id,
          name: perm.card?.name,
          reason: 'legend_rule',
        },
      });
    }
  }

  return { state: updatedState, sacrificed, logs };
}

export function checkAuraAttachmentForState(args: {
  gameId: string;
  state: GameState;
}): { state: GameState; detached: string[]; logs: string[] } {
  const { state } = args;
  const detached: string[] = [];
  const logs: string[] = [];
  let updatedState = state;

  const allPermanents: any[] = [];
  if (state.battlefield) {
    allPermanents.push(...(state.battlefield as any[]));
  }

  for (const perm of allPermanents) {
    const typeLine = (perm.card?.type_line || perm.type_line || '').toLowerCase();
    if (!typeLine.includes('aura')) continue;

    const attachedToId = perm.attachedTo || perm.enchanting;
    if (!attachedToId) {
      detached.push(perm.id);
      logs.push(`${perm.card?.name || 'Aura'} put into graveyard (not attached)`);
      updatedState = movePermanentToGraveyard(updatedState, perm);
      continue;
    }

    const attachedTo = allPermanents.find(entry => entry.id === attachedToId) ||
      state.players.find(player => player.id === attachedToId);

    if (!attachedTo) {
      detached.push(perm.id);
      logs.push(`${perm.card?.name || 'Aura'} put into graveyard (attached permanent no longer exists)`);
      updatedState = movePermanentToGraveyard(updatedState, perm);
    }
  }

  return { state: updatedState, detached, logs };
}
