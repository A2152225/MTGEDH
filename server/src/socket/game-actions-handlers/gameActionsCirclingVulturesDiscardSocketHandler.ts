/**
 * socket/game-actions-handlers/gameActionsCirclingVulturesDiscardSocketHandler.ts
 *
 * Origin parent: game-actions.ts
 * Cluster: handleCirclingVulturesDiscardRequest — special action to discard
 *   Circling Vultures from hand any time you could cast an instant.
 * Public: handleCirclingVulturesDiscardRequest
 */

import type { Server, Socket } from "socket.io";
import { appendEvent } from "../../db/index.js";
import {
  applyCirclingVulturesDiscard,
  getCirclingVulturesDiscardActions,
} from "../../state/modules/circlingVulturesDiscardAction.js";
import type { EnsureInGameRoom } from "./gameActionsSocketRoomGuard.js";
import { debugWarn, debugError } from "../../utils/debug.js";
import { broadcastGame, ensureGame } from "../util.js";

export function handleCirclingVulturesDiscardRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown; cardId?: unknown },
): void {
  const gameId = payload?.gameId;
  const cardId = typeof payload?.cardId === 'string' ? payload.cardId.trim() : '';
  if (!gameId || typeof gameId !== 'string' || !cardId) return;

  try {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;
    if (!ensureInGameRoom(gameId)) return;

    const legal = getCirclingVulturesDiscardActions(game.state, String(playerId))
      .some((action) => action.cardId === cardId);
    if (!legal) {
      socket.emit('error', {
        code: 'VULTURES_DISCARD_NOT_LEGAL',
        message: 'You cannot discard that card as a special action right now.',
      });
      return;
    }

    const result = applyCirclingVulturesDiscard(game, { playerId: String(playerId), cardId });
    if (!result.applied) {
      socket.emit('error', {
        code: 'VULTURES_DISCARD_FAILED',
        message: 'Unable to discard Circling Vultures.',
      });
      return;
    }

    try {
      appendEvent(gameId, game.seq ?? 0, 'circlingVulturesDiscard', {
        playerId,
        cardId,
        card: result.discardedCard,
      });
    } catch (err) {
      debugWarn(1, 'appendEvent(circlingVulturesDiscard) failed:', err);
    }

    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
  } catch (err) {
    debugError(1, `circlingVulturesDiscard error for game ${gameId}:`, err);
  }
}
