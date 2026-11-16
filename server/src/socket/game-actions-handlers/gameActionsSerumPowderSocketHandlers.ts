// server/src/socket/game-actions-handlers/gameActionsSerumPowderSocketHandlers.ts
// Optional Serum Powder opening-hand action: any time the player could
// mulligan and Serum Powder is in hand, exile the hand and draw that many.
// Repeatable. Does not consume a mulligan. Public: handleSerumPowderHandRestartRequest,
// playerCanUseSerumPowder.

import type { Server, Socket } from 'socket.io';
import { appendEvent } from '../../db/index.js';
import { applySerumPowderHandRestart, findSerumPowderInHand } from '../../state/modules/batch92SerumPowder.js';
import { debugError, debugWarn } from '../../utils/debug.js';
import { broadcastGame, ensureGame, getPlayerName } from '../util.js';
import { writePlayerLibraryToContext } from '../../state/modules/zones-handlers/zonesDrawReplacementLibrarySync.js';
import type { PlayerID } from '../../../../shared/src/types.js';

type EnsureInGameRoom = (gameId: string) => boolean;

export function playerCanUseSerumPowder(game: any, playerId: string): { ok: boolean; reason?: string } {
  const pid = String(playerId || '').trim();
  if (!game || !pid) return { ok: false, reason: 'missing-state' };
  const phaseStr = String(game.state?.phase || '').toUpperCase().trim();
  if (phaseStr !== '' && phaseStr !== 'PRE_GAME') return { ok: false, reason: 'not-pregame' };
  const mulliganState = (game.state as any).mulliganState?.[pid];
  if (mulliganState?.hasKeptHand) return { ok: false, reason: 'already-kept' };
  if (mulliganState?.pendingBottomCount && mulliganState.pendingBottomCount > 0) {
    return { ok: false, reason: 'pending-bottom' };
  }
  const currentMulligans = Number(mulliganState?.mulligansTaken || 0);
  if (currentMulligans >= 6) return { ok: false, reason: 'max-mulligans' };
  if (!findSerumPowderInHand(game.state, pid).length) return { ok: false, reason: 'not-in-hand' };
  return { ok: true };
}

export async function handleSerumPowderHandRestartRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown; sourceId?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  try {
    if (!gameId || typeof gameId !== 'string') return;
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;
    if (!ensureInGameRoom(gameId)) return;

    const legal = playerCanUseSerumPowder(game, String(playerId));
    if (!legal.ok) {
      const messages: Record<string, string> = {
        'not-pregame': 'You can only use Serum Powder while you could mulligan.',
        'already-kept': 'You have already kept your hand.',
        'pending-bottom': 'You must finish choosing cards to put on the bottom.',
        'max-mulligans': 'You can no longer mulligan, so you cannot use Serum Powder.',
        'not-in-hand': 'Serum Powder is not in your hand.',
      };
      socket.emit('error', {
        code: 'SERUM_POWDER_NOT_LEGAL',
        message: messages[String(legal.reason || '')] || 'Serum Powder cannot be used now.',
      });
      return;
    }

    const sourceId = typeof payload?.sourceId === 'string' ? payload.sourceId : undefined;
    const result = applySerumPowderHandRestart(game.state, String(playerId), sourceId);
    if (!result.applied) {
      socket.emit('error', {
        code: 'SERUM_POWDER_FAILED',
        message: 'Unable to exile your hand and draw that many cards.',
      });
      return;
    }

    const pid = String(playerId);
    const nextLib = Array.isArray((game.state as any)?.zones?.[pid]?.library)
      ? (game.state as any).zones[pid].library
      : [];
    writePlayerLibraryToContext(game as any, pid, nextLib);
    const hand: any[] = Array.isArray((game.state as any)?.zones?.[pid]?.hand)
      ? (game.state as any).zones[pid].hand
      : [];
    if ((game as any).libraries && typeof (game as any).libraries.set === 'function') {
      (game as any).libraries.set(pid as PlayerID, nextLib);
    }
    if ((game.state as any).zones?.[pid]) {
      (game.state as any).zones[pid].handCount = hand.length;
    }
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();

    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'serumPowderHandRestart', {
        playerId: pid,
        sourceId,
        exiledCount: result.exiled.length,
        drawnCount: result.drawn.length,
        exiledCardIds: result.exiled.map((c: any) => String(c?.id || '')).filter(Boolean),
        drawnCardIds: result.drawn.map((c: any) => String(c?.id || '')).filter(Boolean),
      });
    } catch (err) {
      debugWarn(1, 'appendEvent(serumPowderHandRestart) failed:', err);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} exiles their hand and draws ${result.drawn.length} card${result.drawn.length === 1 ? '' : 's'} (Serum Powder).`,
      ts: Date.now(),
    });
    broadcastGame(io, game, gameId);
  } catch (err: any) {
    debugError(1, `serumPowderHandRestart error for game ${gameId}:`, err);
    socket.emit('error', {
      code: 'SERUM_POWDER_ERROR',
      message: err?.message ?? String(err),
    });
  }
}
