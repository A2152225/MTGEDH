/**
 * socket/resolution-handlers/fightTargetResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse switch).
 * Cluster moved: FIGHT_TARGET case body plus its private getFightAbilityDescription helper.
 * Public entry symbols: handleFightTargetResponse.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { canPermanentBeTargetedByPlayer } from "../../rules-engine/targeting";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { uid } from "../../state/utils.js";
import { debugWarn } from "../../utils/debug.js";
import {
  battlefieldAbilityStackReplayEvidence,
  fireBattlefieldAbilityActivatedTriggers,
} from "../resolutionActivatedAbilityTargetingUtils.js";
import { broadcastGame, emitToPlayer } from "../util.js";

function getFightAbilityDescription(step: any): string {
  const activatedAbilityText = String(step?.activatedAbilityText || step?.description || '').trim();
  if (!activatedAbilityText) {
    return 'This creature fights target creature';
  }

  const parts = activatedAbilityText.split(/:(.+)/);
  const effectText = String(parts[1] || activatedAbilityText).trim();
  return effectText || activatedAbilityText;
}

/** FIGHT_TARGET: validate the chosen creature and put the fight ability on the stack. */
export function handleFightTargetResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const stepData = step as any;
  const selection = response.selections as any;
  const sourceId = String(step.sourceId || stepData.sourceId || '');

  const targetCreatureId = Array.isArray(selection)
    ? String(selection[0] || '')
    : (typeof selection === 'string'
        ? selection
        : String(selection?.targetCreatureId || ''));

  if (!sourceId) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'SOURCE_NOT_FOUND',
      message: 'Fight source not found',
    });
    return;
  }

  if (!targetCreatureId) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET',
      message: 'Must choose a target creature to fight',
    });
    return;
  }

  const battlefield = game.state?.battlefield || [];
  const sourceCreature = battlefield.find((p: any) => p?.id === sourceId);
  const targetCreature = battlefield.find((p: any) => p?.id === targetCreatureId);

  if (!sourceCreature) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'SOURCE_NOT_FOUND',
      message: 'Source creature not found on battlefield',
    });
    return;
  }

  if (!targetCreature) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET',
      message: 'Target creature not found on battlefield',
    });
    return;
  }

  const sourceTypeLine = String(sourceCreature.card?.type_line || '').toLowerCase();
  const targetTypeLine = String(targetCreature.card?.type_line || '').toLowerCase();
  if (!sourceTypeLine.includes('creature')) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_SOURCE',
      message: 'Fight source must be a creature',
    });
    return;
  }
  if (!targetTypeLine.includes('creature')) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET',
      message: 'Target must be a creature',
    });
    return;
  }

  const targetFilter = stepData.targetFilter || {};
  const controllerFilter: 'you' | 'opponent' | 'any' = targetFilter.controller || 'any';
  const excludeSource = targetFilter.excludeSource !== false;

  if (excludeSource && targetCreatureId === sourceId) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET',
      message: 'Target must be a different creature',
    });
    return;
  }

  if (controllerFilter === 'you' && targetCreature.controller !== pid) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET',
      message: 'Target must be a creature you control',
    });
    return;
  }

  if (controllerFilter === 'opponent' && targetCreature.controller === pid) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET',
      message: "Target must be a creature you don't control",
    });
    return;
  }

  if (!canPermanentBeTargetedByPlayer(targetCreature as any, game.state as any, pid as any)) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET',
      message: 'Target cannot be legally targeted',
    });
    return;
  }

  const sourceName = String(step.sourceName || sourceCreature.card?.name || 'Creature');
  const targetName = String(targetCreature.card?.name || 'Creature');
  const activatedAbilityText = String(stepData.activatedAbilityText || stepData.description || '').trim();
  const description = getFightAbilityDescription(stepData);

  (game.state as any).stack = Array.isArray((game.state as any).stack) ? (game.state as any).stack : [];
  const stackItem = {
    id: uid('ability'),
    type: 'ability' as const,
    controller: pid,
    source: sourceId,
    sourceName,
    description,
    activatedAbilityText: activatedAbilityText || description,
    abilityType: 'fight' as const,
    targets: [targetCreatureId],
    fightParams: {
      sourceCreatureId: sourceId,
      targetCreatureId,
      sourceCreatureName: sourceName,
      targetCreatureName: targetName,
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
        abilityType: 'fight',
        targets: [targetCreatureId],
        tappedPermanents: Boolean(sourceCreature?.tapped) ? [sourceId] : [],
      });
    } catch (e) {
      debugWarn(1, 'appendEvent(activateBattlefieldAbility:fight) failed:', e);
    }
  });

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${sourceName} targets ${targetName} to fight. Ability on the stack.`,
    ts: Date.now(),
  });

  broadcastGame(io, game, gameId);
}
