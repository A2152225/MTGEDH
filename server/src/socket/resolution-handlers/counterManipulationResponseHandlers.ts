/**
 * socket/resolution-handlers/counterManipulationResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse switch).
 * Cluster moved: COUNTER_MOVEMENT, COUNTER_TARGET and COUNTER_DISTRIBUTION case bodies.
 * Public entry symbols: handleCounterMovementResponse, handleCounterTargetResponse,
 * handleCounterDistributionResponse.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import {
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
} from "../../state/modules/oracleIrServerZoneSync.js";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { uid } from "../../state/utils.js";
import { debugWarn } from "../../utils/debug.js";
import {
  battlefieldAbilityStackReplayEvidence,
  fireBattlefieldAbilityActivatedTriggers,
} from "../resolutionActivatedAbilityTargetingUtils.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";

/** COUNTER_MOVEMENT: move one counter of the chosen kind between two battlefield permanents. */
export function handleCounterMovementResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const stepData = step as any;
  const payload = response.selections as any;

  const sourcePermanentId = String(payload?.sourcePermanentId || payload?.sourceId || '');
  const targetPermanentId = String(payload?.targetPermanentId || payload?.targetId || '');
  const counterType = String(payload?.counterType || '');

  if (!sourcePermanentId || !targetPermanentId || !counterType) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_SELECTION',
      message: 'Invalid counter movement selection',
    });
    return;
  }

  if (sourcePermanentId === targetPermanentId) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET',
      message: 'Target must be a different permanent',
    });
    return;
  }

  const battlefield = game.state?.battlefield || [];
  const sourcePerm = battlefield.find((p: any) => p?.id === sourcePermanentId);
  const targetPerm = battlefield.find((p: any) => p?.id === targetPermanentId);

  if (!sourcePerm) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'SOURCE_NOT_FOUND',
      message: 'Source permanent not found on battlefield',
    });
    return;
  }

  if (!targetPerm) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'TARGET_NOT_FOUND',
      message: 'Target permanent not found on battlefield',
    });
    return;
  }

  const sourceFilter = stepData.sourceFilter || {};
  const targetFilter = stepData.targetFilter || {};

  if (sourceFilter.controller === 'you' && sourcePerm.controller !== pid) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_SOURCE',
      message: 'Source must be a permanent you control',
    });
    return;
  }

  if (targetFilter.controller === 'you' && targetPerm.controller !== pid) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET',
      message: 'Target must be a permanent you control',
    });
    return;
  }

  if (targetFilter.excludeSource && sourcePermanentId === targetPermanentId) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET',
      message: 'Target must be different from source',
    });
    return;
  }

  const sourceCounters = (sourcePerm as any).counters || {};
  const current = Number(sourceCounters[counterType] || 0);
  if (current <= 0) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'NO_COUNTER',
      message: `Source permanent has no ${counterType} counters`,
    });
    return;
  }

  sourceCounters[counterType] = current - 1;
  if (sourceCounters[counterType] <= 0) {
    delete sourceCounters[counterType];
  }
  (sourcePerm as any).counters = sourceCounters;

  const targetCounters = (targetPerm as any).counters || {};
  targetCounters[counterType] = Number(targetCounters[counterType] || 0) + 1;
  (targetPerm as any).counters = targetCounters;

  const sourceName = String((sourcePerm as any).card?.name || 'permanent');
  const targetName = String((targetPerm as any).card?.name || 'permanent');
  const abilityName = String(step.sourceName || stepData.title || 'an ability');

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} used ${abilityName} to move a ${counterType} counter from ${sourceName} to ${targetName}.`,
    ts: Date.now(),
  });

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'counter_moved', {
      playerId: pid,
      resolvedStepId: String((step as any).id || ''),
      sourcePermanentId,
      targetPermanentId,
      counterType,
      source: abilityName,
      ts: Date.now(),
    });
  } catch (e) {
    debugWarn(1, 'appendEvent(counter_moved) failed:', e);
  }

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }

  broadcastGame(io, game, gameId);
}

/** COUNTER_TARGET: put the add-counter ability on the stack against the chosen permanent. */
export function handleCounterTargetResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const stepData = step as any;
  const selection = response.selections as any;

  const targetId = Array.isArray(selection)
    ? String(selection[0] || '')
    : (typeof selection === 'string' ? selection : String(selection?.targetId || ''));

  if (!targetId) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET',
      message: 'Must choose a target permanent',
    });
    return;
  }

  const counterType = String(stepData.counterType || '').toLowerCase();
  if (!counterType) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_SELECTION',
      message: 'Missing counter type',
    });
    return;
  }

  const battlefield = game.state?.battlefield || [];
  const targetPermanent = battlefield.find((p: any) => p?.id === targetId);
  if (!targetPermanent) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET',
      message: 'Target permanent not found on battlefield',
    });
    return;
  }

  const targetControllerRule: 'opponent' | 'any' | 'you' = stepData.targetController || 'any';
  if (targetControllerRule === 'you' && String(targetPermanent.controller) !== String(pid)) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET',
      message: 'Target must be a permanent you control',
    });
    return;
  }
  if (targetControllerRule === 'opponent' && String(targetPermanent.controller) === String(pid)) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET',
      message: "Target must be a permanent you don't control",
    });
    return;
  }

  const sourceId = String(step.sourceId || stepData.sourceId || '').trim();
  const sourceName = String(step.sourceName || stepData.title || 'an ability');
  const targetName = String((targetPermanent as any).card?.name || 'permanent');
  const activatedAbilityText = String(stepData.oracleText || step.description || '').trim();
  const description = activatedAbilityText || `${sourceName} puts a ${counterType} counter on target ${String(stepData.targetDescription || 'permanent')}`;

  (game.state as any).stack = Array.isArray((game.state as any).stack) ? (game.state as any).stack : [];
  const stackItem = {
    id: uid('ability'),
    type: 'ability' as const,
    controller: pid,
    source: sourceId,
    sourceName,
    description,
    activatedAbilityText: activatedAbilityText || description,
    abilityType: 'add_counter' as const,
    targets: [targetId],
    counterParams: {
      targetId,
      targetName,
      counterType,
      targetControllerRule,
      oracleText: String(stepData.oracleText || ''),
      scalingText: stepData.scalingText ? String(stepData.scalingText) : null,
    },
  };
  (game.state as any).stack.push(stackItem);

  fireBattlefieldAbilityActivatedTriggers(game, String(pid), sourceId, description, gameId, stackItem.id, () => {
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
        ...battlefieldAbilityStackReplayEvidence(stackItem.id),
        playerId: pid,
        resolvedStepId: String((step as any).id || ''),
        permanentId: sourceId,
        abilityId: String(stepData.abilityId || ''),
        cardName: sourceName,
        abilityText: description,
        activatedAbilityText: activatedAbilityText || description,
        abilityType: 'add_counter',
        targets: [targetId],
        counterParams: stackItem.counterParams,
      });
    } catch (e) {
      debugWarn(1, 'appendEvent(activateBattlefieldAbility:add_counter) failed:', e);
    }
  });

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${sourceName} targets ${targetName}. Ability on the stack.`,
    ts: Date.now(),
  });

  broadcastGame(io, game, gameId);
}

/** COUNTER_DISTRIBUTION: validate the divided counter assignment and resume the Oracle IR program. */
export function handleCounterDistributionResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const stepData = step as any;
  const distribution = response.selections as any;
  if (!distribution || typeof distribution !== 'object' || Array.isArray(distribution)) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_SELECTION',
      message: 'Invalid counter distribution format',
    });
    return;
  }

  const totalAmount = Number(stepData.totalAmount ?? 0);
  const minPerTarget = Math.max(1, Number(stepData.minPerTarget ?? 1));
  const counterType = String(stepData.counterType || '+1/+1').trim();
  const validTargetIds = new Set(
    (Array.isArray(stepData.validTargets) ? stepData.validTargets : [])
      .map((entry: any) => String(entry?.id || '').trim())
      .filter(Boolean),
  );

  let totalDistributed = 0;
  for (const [targetId, amountRaw] of Object.entries(distribution)) {
    const targetKey = String(targetId || '').trim();
    const amount = Number(amountRaw ?? 0);
    if (amount <= 0) continue;
    if (!validTargetIds.has(targetKey)) {
      emitToPlayer(io, pid as any, 'error', {
        code: 'INVALID_TARGET',
        message: 'Counter distribution includes an invalid target',
      });
      return;
    }
    if (amount < minPerTarget) {
      emitToPlayer(io, pid as any, 'error', {
        code: 'INVALID_DISTRIBUTION',
        message: `Each target must receive at least ${minPerTarget} counter(s)`,
      });
      return;
    }
    totalDistributed += amount;
  }

  if (totalAmount > 0 && totalDistributed !== totalAmount) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_DISTRIBUTION',
      message: `Total counters distributed (${totalDistributed}) must equal ${totalAmount}`,
    });
    return;
  }

  const ctx = ((game as any).ctx || game) as any;
  ctx.gameId = gameId;
  ctx.state = game.state;
  const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, step, response);
  if (resumed) {
    maybeResumeOracleIRStepsAfterResolution(ctx, step);
  }

  const sourceName = String(step.sourceName || stepData.title || 'an ability');
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} distributed ${totalDistributed} ${counterType} counter(s) with ${sourceName}.`,
    ts: Date.now(),
  });

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
  broadcastGame(io, game, gameId);
}
