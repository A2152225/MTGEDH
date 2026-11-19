/**
 * Option-choice answers for space sculptor sector assignment and sector effects.
 * Public: tryHandleSpaceSculptorOptionChoice
 */

import type { Server } from 'socket.io';
import type { GameContext } from '../state/context.js';
import { applySpaceSculptorOptionChoice } from '../state/modules/spaceSculptor.js';
import { applySpaceSculptorSectorEffect } from '../state/modules/spaceSculptorEffects.js';
import { ResolutionQueueManager, type ResolutionStep, type ResolutionStepResponse } from '../state/resolution/index.js';
import { emitToPlayer, getPlayerName } from './util.js';

function selectedId(selections: unknown): string {
  if (typeof selections === 'string') return selections;
  if (Array.isArray(selections) && selections.length > 0) {
    const first = selections[0];
    if (typeof first === 'string') return first;
    return String((first as any)?.id || (first as any)?.value || '');
  }
  if (selections && typeof selections === 'object') {
    return String((selections as any).id || (selections as any).value || '');
  }
  return '';
}

export async function tryHandleSpaceSculptorOptionChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const stepData = step as any;
  if (stepData?.spaceSculptorSectorChoice !== true && stepData?.spaceSculptorEffectChoice !== true) return false;

  const ctx = {
    state: game.state,
    libraries: game.libraries,
    gameId,
    seq: game.seq,
    bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : () => {},
    rng: game.rng,
  } as unknown as GameContext;

  ResolutionQueueManager.completeStep(gameId, step.id, response);
  const chosen = selectedId(response.selections);
  const result = stepData?.spaceSculptorEffectChoice === true
    ? applySpaceSculptorSectorEffect(ctx, stepData, chosen)
    : applySpaceSculptorOptionChoice(ctx, stepData, chosen);
  if (!result.ok) {
    emitToPlayer(io, response.playerId as any, 'error', {
      code: 'INVALID_SECTOR_CHOICE',
      message: result.error || 'Unable to apply that sector choice.',
    });
    return true;
  }

  const sector = selectedId(response.selections);
  const label = sector ? `${sector} sector` : 'a sector';
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, response.playerId)} chose ${label}.`,
    ts: Date.now(),
  });
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  return true;
}
