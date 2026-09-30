/**
 * socket/resolution-handlers/stationCreatureSelectionResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse switch).
 * Cluster moved: STATION_CREATURE_SELECTION case body (Edge of Eternities "Station N").
 * Public entry symbols: handleStationCreatureSelectionResponse.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import type { GameContext } from "../../state/context.js";
import { tryApplyStationChargeCountersViaOracleIR } from "../../state/modules/oracleIrAbilityExecution.js";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { appendGameEvent, broadcastGame, emitToPlayer, getEffectivePower, getPlayerName } from "../util.js";

/** STATION_CREATURE_SELECTION: tap the chosen creature to add charge counters to the station. */
export function handleStationCreatureSelectionResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const stepData = step as any;
  const selection = response.selections as any;

  const creatureId = Array.isArray(selection)
    ? String(selection[0] || '')
    : (typeof selection === 'string' ? selection : String(selection?.creatureId || ''));

  if (!creatureId) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_SELECTION',
      message: 'Must choose a creature to tap',
    });
    return;
  }

  const battlefield = game.state?.battlefield || [];
  const stationId = String(stepData?.tapForCountersSource?.id || stepData?.station?.id || step.sourceId || '');
  const station = battlefield.find((p: any) => p?.id === stationId);
  if (!station) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'STATION_NOT_FOUND',
      message: 'Station permanent not found',
    });
    return;
  }

  const creature = battlefield.find((p: any) => p?.id === creatureId);
  if (!creature) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'CREATURE_NOT_FOUND',
      message: 'Selected creature not found',
    });
    return;
  }

  if (creature.id === stationId) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET',
      message: 'Must tap another creature (not the station itself)',
    });
    return;
  }

  if (creature.controller !== pid) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'NOT_YOUR_CREATURE',
      message: "You don't control this creature",
    });
    return;
  }

  if ((creature as any).tapped) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'CREATURE_TAPPED',
      message: 'This creature is already tapped',
    });
    return;
  }

  const creatureTypeLine = String((creature as any).card?.type_line || '').toLowerCase();
  if (!creatureTypeLine.includes('creature')) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'NOT_A_CREATURE',
      message: 'Selected permanent is not a creature',
    });
    return;
  }

  const creaturePower = getEffectivePower(creature, game.state);
  const countersToAdd = Math.max(0, Number(creaturePower || 0));
  const creatureName = String((creature as any).card?.name || 'creature');
  const counterType = String(stepData?.tapForCountersSource?.counterType || 'charge');
  const stationThreshold = Number(stepData?.tapForCountersSource?.threshold || stepData?.station?.threshold || 0);
  const stationName = String((station as any).card?.name || stepData?.tapForCountersSource?.name || stepData?.station?.name || step.sourceName || 'Station');

  // Tap the creature
  (creature as any).tapped = true;

  const stationCtx: GameContext = {
    state: game.state,
    libraries: (game as any).libraries,
    bumpSeq: () => {
      if (typeof game.bumpSeq === 'function') game.bumpSeq();
    },
    rng: (game as any).rng,
    gameId,
  } as any;

  const irResult = tryApplyStationChargeCountersViaOracleIR(stationCtx, {
    controller: pid as PlayerID,
    sourcePermanentId: stationId,
    sourceName: stationName,
    stationedCreaturePower: countersToAdd,
    effectText: String(stepData?.stationEffectText || stepData?.tapForCountersSource?.effectText || ''),
    typeLine: String((station as any).card?.type_line || ''),
    stationAbilityOracleText: String((station as any).card?.oracle_text || ''),
  });

  let countersAdded = countersToAdd;
  if (irResult.handled) {
    countersAdded = irResult.countersAdded;
  } else {
    // Fallback when IR cannot resolve "equal to its power" without runtime context wiring.
    (station as any).counters = (station as any).counters || {};
    const currentCounters = Number((station as any).counters[counterType] || 0);
    (station as any).counters[counterType] = currentCounters + countersToAdd;
  }

  const stationAfterCounters = (game.state as any).battlefield?.find((p: any) => p?.id === stationId) || station;
  const newCounterCount = Number((stationAfterCounters as any).counters?.[counterType] || 0);

  // Check if threshold is met
  if (stationThreshold > 0 && newCounterCount >= stationThreshold && !(stationAfterCounters as any).stationed) {
    (stationAfterCounters as any).stationed = true;
    (stationAfterCounters as any).grantedTypes = (stationAfterCounters as any).grantedTypes || [];
    if (!(stationAfterCounters as any).grantedTypes.includes('Creature')) {
      (stationAfterCounters as any).grantedTypes.push('Creature');
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `🚀 ${getPlayerName(game, pid)} tapped ${creatureName} (power ${creaturePower}) to station ${stationName}! It gained ${countersAdded} charge counter${countersAdded !== 1 ? 's' : ''} (${newCounterCount}/${stationThreshold}) and is now an artifact creature!`,
      ts: Date.now(),
    });
  } else {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `⚡ ${getPlayerName(game, pid)} tapped ${creatureName} (power ${creaturePower}) to add ${countersAdded} charge counter${countersAdded !== 1 ? 's' : ''} to ${stationName}. (${newCounterCount}/${stationThreshold})`,
      ts: Date.now(),
    });
  }

  const stationedNow = Boolean((stationAfterCounters as any).stationed);
  appendGameEvent(game, gameId, 'station_activated', {
    playerId: pid,
    resolvedStepId: String((step as any).id || '').trim() || undefined,
    stationId,
    stationName,
    creatureId,
    creatureName,
    creaturePower,
    counterType,
    countersAdded,
    totalCounters: newCounterCount,
    threshold: stationThreshold,
    stationed: stationedNow,
    ...(stationedNow
      ? {
          grantedTypes: Array.isArray((stationAfterCounters as any).grantedTypes)
            ? [...(stationAfterCounters as any).grantedTypes]
            : ['Creature'],
        }
      : null),
    ts: Date.now(),
  });

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
  broadcastGame(io, game, gameId);
}
