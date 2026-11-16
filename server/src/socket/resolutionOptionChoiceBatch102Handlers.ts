// server/src/socket/resolutionOptionChoiceBatch102Handlers.ts
// OPTION_CHOICE / MANA_PAYMENT_CHOICE handlers for Sanctuary Blade color
// choice and Recover mana payment. Public: tryHandleBatch102OptionChoice,
// queueRecoverManaPaymentIfNeeded, tryHandleRecoverManaPayment.

import type { Server } from 'socket.io';
import type { ResolutionStep, ResolutionStepResponse } from '../state/resolution/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../state/resolution/index.js';
import { applySanctuaryBladeChosenColor } from '../state/modules/batch102Apply.js';
import { applyRecoverDecision } from '../state/modules/batch101LandRecoverSurveil.js';
import { parseRecoverCost } from '../state/modules/batch101Parsers.js';
import {
  applySelectedManaPaymentForResolutionCost,
  extractResolutionPaymentItems,
} from './resolution-handlers/resolutionManaPaymentApplication.js';
import { broadcastGame, broadcastManaPoolUpdate, emitToPlayer, getPlayerName } from './util.js';
import { debugWarn } from '../utils/debug.js';

function selectedId(response: ResolutionStepResponse): string {
  const anyResp = response as any;
  if (typeof anyResp.selectedOption === 'string') return anyResp.selectedOption;
  if (typeof anyResp.optionId === 'string') return anyResp.optionId;
  if (typeof anyResp.choice === 'string') return anyResp.choice;
  const selections = anyResp.selections;
  if (Array.isArray(selections) && selections[0]) return String(selections[0]?.id || selections[0]);
  return String(anyResp.value || '').trim();
}

export function queueRecoverManaPaymentIfNeeded(
  game: any,
  gameId: string,
  ownerId: string,
  cardId: string,
  recoverCost: { kind: string; cost?: string } | null | undefined,
): boolean {
  if (!recoverCost || recoverCost.kind !== 'mana' || !recoverCost.cost) return false;
  const gid = String(gameId || game?.gameId || '').trim();
  if (!gid) return false;
  ResolutionQueueManager.addStep(gid, {
    type: ResolutionStepType.MANA_PAYMENT_CHOICE,
    playerId: ownerId as any,
    description: `Recover: Pay ${recoverCost.cost} to return this card to your hand, or cancel to exile it.`,
    mandatory: false,
    sourceId: cardId,
    sourceName: 'Recover',
    manaCost: recoverCost.cost,
    activationPaymentChoice: true,
    recoverManaPayment: true,
    recoverCardId: cardId,
    recoverOwnerId: ownerId,
  } as any);
  return true;
}

export async function tryHandleBatch102OptionChoice(
  _io: Server,
  game: any,
  _gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const stepData = step as any;
  const choice = selectedId(response);

  if (stepData?.sanctuaryBladeColorChoice === true) {
    applySanctuaryBladeChosenColor(game.state, String(stepData.sanctuaryBladeEquipmentId || stepData.sourceId || ''), choice);
    return true;
  }

  return false;
}

export async function tryHandleRecoverManaPayment(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const stepData = step as any;
  if (stepData.recoverManaPayment !== true) return false;
  const pid = response.playerId;
  const ownerId = String(stepData.recoverOwnerId || pid || '');
  const cardId = String(stepData.recoverCardId || step.sourceId || '');
  const manaCost = String(stepData.manaCost || '').trim();

  if (response.cancelled) {
    applyRecoverDecision(game.state, ownerId, cardId, false);
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  const payment = extractResolutionPaymentItems(response.selections as any);
  const applied = applySelectedManaPaymentForResolutionCost(game, pid, manaCost, payment);
  if (!applied.ok) {
    const appliedError = applied as { ok: false; code: string; message: string };
    emitToPlayer(io, pid as any, 'error', { code: appliedError.code, message: appliedError.message });
    return true;
  }

  applyRecoverDecision(game.state, ownerId, cardId, true);
  try {
    broadcastManaPoolUpdate(io, gameId, pid, ((game.state as any)?.manaPool?.[pid] || {}) as any, `Paid ${manaCost} for Recover`, game);
  } catch (err) {
    debugWarn(1, '[Resolution] recoverManaPayment mana-pool broadcast failed:', err);
  }
  try {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} pays ${manaCost} for Recover.`,
      ts: Date.now(),
    });
  } catch {}
  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
  broadcastGame(io, game, gameId);
  return true;
}

export { parseRecoverCost };
