// Kitchen-table manual mode socket handlers.
// Mutations go through applyManualAction and are persisted as `manualAction`
// so replay/undo reconstruct the same table change.

import type { Server, Socket } from 'socket.io';
import { appendEvent } from '../db/index.js';
import { debug, debugError, debugWarn } from '../utils/debug.js';
import { broadcastGame, ensureGame, getPlayerName } from './util.js';
import { applyManualAction, peekManualZone } from '../state/modules/manualActionApply.js';
import {
  isManualVerbId,
  type ManualActionPayload,
  type ManualZone,
} from '../../../shared/src/manualAction.js';

type Ack = (result: {
  ok: boolean;
  error?: string;
  summary?: string;
  peekedCards?: Array<{ id: string; name: string; type_line?: string; image_uris?: any }>;
}) => void;

function asCtx(game: any) {
  return (game as any).ctx || game;
}

export function registerManualActionHandlers(io: Server, socket: Socket): void {
  socket.on('manualPeek', (payload?: {
    gameId?: unknown;
    playerId?: unknown;
    zone?: unknown;
    count?: unknown;
  }, ack?: Ack) => {
    const gameId = typeof payload?.gameId === 'string' ? payload.gameId : '';
    const zone = String(payload?.zone || 'library') as ManualZone | 'library_top';
    const count = typeof payload?.count === 'number' ? payload.count : undefined;
    const actorId = String((socket.data as any)?.playerId || '').trim();
    const spectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
    if (!gameId || !actorId || spectator) {
      ack?.({ ok: false, error: 'Not in this game.' });
      return;
    }
    try {
      const game = ensureGame(gameId);
      if (!game) {
        ack?.({ ok: false, error: 'Game not found.' });
        return;
      }
      const socketGameId = String((socket.data as any)?.gameId || '');
      if (socketGameId && socketGameId !== gameId) {
        ack?.({ ok: false, error: 'You are not in this game.' });
        return;
      }
      const targetPlayerId = typeof payload?.playerId === 'string' && payload.playerId
        ? payload.playerId
        : actorId;
      if (targetPlayerId !== actorId && (zone === 'library' || zone === 'library_top' || zone === 'hand')) {
        ack?.({ ok: false, error: 'You can only peek your own hidden zones.' });
        return;
      }
      const result = peekManualZone(asCtx(game), targetPlayerId, zone, count);
      ack?.({ ok: result.ok, summary: result.summary, peekedCards: result.peekedCards, error: result.error });
    } catch (err: any) {
      debugError(1, '[manualPeek] failed:', err);
      ack?.({ ok: false, error: err?.message ?? String(err) });
    }
  });

  socket.on('manualAction', (payload?: Record<string, unknown>, ack?: Ack) => {
    const gameId = typeof payload?.gameId === 'string' ? payload.gameId : '';
    const actorId = String((socket.data as any)?.playerId || '').trim();
    const spectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
    if (!gameId || !actorId || spectator) {
      ack?.({ ok: false, error: 'Not in this game.' });
      return;
    }
    if (!isManualVerbId(payload?.verb)) {
      ack?.({ ok: false, error: 'Unknown manual verb.' });
      return;
    }
    try {
      const game = ensureGame(gameId);
      if (!game) {
        ack?.({ ok: false, error: 'Game not found.' });
        return;
      }
      const socketGameId = String((socket.data as any)?.gameId || '');
      if (socketGameId && socketGameId !== gameId) {
        ack?.({ ok: false, error: 'You are not in this game.' });
        return;
      }

      const action: ManualActionPayload = {
        verb: payload.verb,
        actorId,
        targetPlayerId: typeof payload.targetPlayerId === 'string' ? payload.targetPlayerId : actorId,
        objectIds: Array.isArray(payload.objectIds) ? payload.objectIds.map((id) => String(id || '').trim()).filter(Boolean) : undefined,
        count: typeof payload.count === 'number' ? payload.count : undefined,
        amount: typeof payload.amount === 'number' ? payload.amount : undefined,
        fromZone: payload.fromZone as ManualActionPayload['fromZone'],
        toZone: payload.toZone as ManualActionPayload['toZone'],
        position: payload.position as ManualActionPayload['position'],
        nth: typeof payload.nth === 'number' ? payload.nth : undefined,
        tapped: typeof payload.tapped === 'boolean' ? payload.tapped : undefined,
        faceDown: typeof payload.faceDown === 'boolean' ? payload.faceDown : undefined,
        controllerId: typeof payload.controllerId === 'string' ? payload.controllerId : undefined,
        attachToId: typeof payload.attachToId === 'string' ? payload.attachToId : undefined,
        counterType: typeof payload.counterType === 'string' ? payload.counterType : undefined,
        manaColor: payload.manaColor as ManualActionPayload['manaColor'],
        tokenName: typeof payload.tokenName === 'string' ? payload.tokenName : undefined,
        tokenPower: typeof payload.tokenPower === 'number' ? payload.tokenPower : undefined,
        tokenToughness: typeof payload.tokenToughness === 'number' ? payload.tokenToughness : undefined,
        tokenTypeLine: typeof payload.tokenTypeLine === 'string' ? payload.tokenTypeLine : undefined,
        searchName: typeof payload.searchName === 'string' ? payload.searchName : undefined,
        keepTopIds: Array.isArray(payload.keepTopIds) ? payload.keepTopIds.map((id) => String(id)) : undefined,
        bottomIds: Array.isArray(payload.bottomIds) ? payload.bottomIds.map((id) => String(id)) : undefined,
        graveyardIds: Array.isArray(payload.graveyardIds) ? payload.graveyardIds.map((id) => String(id)) : undefined,
        libraryOrder: Array.isArray(payload.libraryOrder) ? payload.libraryOrder.map((id) => String(id)) : undefined,
        drawnCardIds: Array.isArray(payload.drawnCardIds) ? payload.drawnCardIds.map((id) => String(id)) : undefined,
        createdPermanentIds: Array.isArray(payload.createdPermanentIds) ? payload.createdPermanentIds.map((id) => String(id)) : undefined,
        outcome: payload.outcome === 'win' || payload.outcome === 'lose' ? payload.outcome : undefined,
        note: typeof payload.note === 'string' ? payload.note : undefined,
      };

      const result = applyManualAction(asCtx(game), action);
      if (!result.ok) {
        ack?.({ ok: false, error: result.error || result.summary, summary: result.summary });
        return;
      }

      const privatePeek = action.verb === 'look_at_top_x' || action.verb === 'look_at_hand';
      if (privatePeek) {
        ack?.({ ok: true, summary: result.summary, peekedCards: result.peekedCards });
        return;
      }

      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'manualAction', { ...action, summary: result.summary });
      } catch (err) {
        debugWarn(1, 'appendEvent(manualAction) failed:', err);
      }

      const actorName = getPlayerName(game, actorId);
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Manual: ${actorName} ${result.summary}${result.publicPeek && result.peekedCards?.length
          ? ` (${result.peekedCards.map((c) => c.name).filter(Boolean).join(', ')})`
          : ''}`,
        ts: Date.now(),
      });

      debug(2, `[manualAction] ${actorName} ${result.summary} in ${gameId}`);
      broadcastGame(io, game, gameId);
      ack?.({
        ok: true,
        summary: result.summary,
        peekedCards: result.peekedCards,
      });
    } catch (err: any) {
      debugError(1, '[manualAction] failed:', err);
      ack?.({ ok: false, error: err?.message ?? String(err) });
    }
  });
}
