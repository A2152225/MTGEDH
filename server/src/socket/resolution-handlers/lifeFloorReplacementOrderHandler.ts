/**
 * OPTION_CHOICE handler for CR 616.1 life-floor replacement order
 * (two or more Enduring Angel-style floors).
 */
import type { Server } from 'socket.io';
import type { ResolutionStep, ResolutionStepResponse } from '../../state/resolution/index.js';
import {
  applyLifeFloorReplacementAfterChoice,
  LIFE_FLOOR_REPLACEMENT_ORDER_FLAG,
} from '../../state/modules/lifeFloorReplacementOrder.js';
import { broadcastGame, getPlayerName } from '../util.js';

function firstId(value: unknown): string {
  if (Array.isArray(value) && value.length) {
    const first = value[0];
    if (typeof first === 'string') return first.trim();
    if (first && typeof first === 'object') return String((first as any).id || (first as any).value || '').trim();
    return String(first || '').trim();
  }
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') return String((value as any).id || (value as any).value || '').trim();
  return '';
}

export async function tryHandleLifeFloorReplacementOrderChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const stepData = step as any;
  if (stepData?.[LIFE_FLOOR_REPLACEMENT_ORDER_FLAG] !== true) return false;
  const playerId = String(stepData.lifeFloorPlayerId || response.playerId || step.playerId || '').trim();
  const chosenId = firstId(response.selections);
  const result = applyLifeFloorReplacementAfterChoice({
    ctx: { state: game.state || game },
    playerId,
    currentLife: Number(stepData.lifeFloorCurrentLife),
    lossAmount: Number(stepData.lifeFloorLossAmount),
    chosenId,
  });
  try {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: result.applied
        ? `${getPlayerName(game, playerId)} applied a life-floor replacement first (CR 616.1); life total is now ${result.nextLife}.`
        : `${getPlayerName(game, playerId)} chose a life-floor replacement (CR 616.1).`,
      ts: Date.now(),
    });
  } catch { /* chat is best-effort */ }
  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
  try { broadcastGame(io, game, gameId); } catch { /* broadcast is best-effort */ }
  return true;
}
