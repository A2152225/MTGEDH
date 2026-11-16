/**
 * Origin parent: server/src/socket/resolution-handlers/optionChoiceResponseHandlers.ts
 * Cluster: resume a creature cast after the Offspring pay / decline choice.
 * Public entry symbols: tryHandleOffspringCastChoice.
 */

import type { Server } from 'socket.io';
import type { ResolutionStep, ResolutionStepResponse } from '../../state/resolution/index.js';
import { requestCastSpellForSocket } from '../game-actions.js';
import { broadcastGame } from '../util.js';

function selectedId(response: ResolutionStepResponse): string {
  const anyResp = response as any;
  if (anyResp?.cancelled) return 'decline';
  const selections = anyResp?.selections;
  if (Array.isArray(selections) && selections[0]) return String(selections[0]?.id || selections[0]);
  if (typeof selections === 'string') return selections;
  return String(anyResp?.selectedOption || anyResp?.optionId || 'decline');
}

export async function tryHandleOffspringCastChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const stepAny = step as any;
  if (stepAny?.offspringCastChoice !== true) return false;
  if ((response as any)?.cancelled) return true;
  const pay = selectedId(response) === 'pay';
  const pid = String(response.playerId || stepAny.playerId || '');
  await requestCastSpellForSocket(
    io,
    {
      data: { playerId: pid },
      emit: (_event: string, _payload: any) => {},
    } as any,
    {
      gameId,
      cardId: stepAny.spellCardId,
      faceIndex: stepAny.spellFaceIndex,
      fromZone: stepAny.spellFromZone,
    },
    {
      skipPriorityCheck: true,
      forcedAlternateCostId: typeof stepAny.spellForcedAlternateCostId === 'string' ? stepAny.spellForcedAlternateCostId : undefined,
      castWithoutPayingManaCost: stepAny.spellCastWithoutPayingManaCost === true,
      bypassExilePermissionCheck: stepAny.spellBypassExilePermissionCheck === true,
      ignoreTimingRestrictions: stepAny.spellIgnoreTimingRestrictions === true,
      xValue: Number.isFinite(stepAny.spellXValue) ? Math.max(0, Math.floor(Number(stepAny.spellXValue))) : undefined,
      timesKicked: Number.isFinite(stepAny.spellTimesKicked) ? Math.max(0, Math.floor(Number(stepAny.spellTimesKicked))) : undefined,
      replicateCount: Number.isFinite(stepAny.spellReplicateCount) ? Math.max(0, Math.floor(Number(stepAny.spellReplicateCount))) : undefined,
      offspringPaid: pay,
    },
  );
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
  return true;
}
