/**
 * Socket: plot the top card of your library (Fblthp special action).
 * Public: handlePlotLibraryTopRequest.
 */
import type { Server, Socket } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { applyPlotLibraryTopCard, getLibraryTopPlotAction } from "../../state/modules/batch96PlotAction.js";
import { debugError, debugWarn } from "../../utils/debug.js";
import type { EnsureInGameRoom } from "./gameActionsSocketRoomGuard.js";
import { broadcastGame, ensureGame, getPlayerName, payManaCostWithAvailableSources } from "../util.js";

export function handlePlotLibraryTopRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown },
): void {
  const gameId = payload?.gameId;
  if (!gameId || typeof gameId !== 'string') return;

  try {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;
    if (!ensureInGameRoom(gameId)) return;

    const state = game.state;
    const turnPlayer = String((state as any)?.turnPlayer || '').trim();
    if (turnPlayer && turnPlayer !== String(playerId)) {
      socket.emit('error', { code: 'NOT_YOUR_TURN', message: 'You can only plot the top card of your library during your turn.' });
      return;
    }
    const priority = (state as any)?.priority;
    if (priority && String(priority) !== String(playerId)) {
      socket.emit('error', { code: 'NO_PRIORITY', message: 'You need priority to plot the top card of your library.' });
      return;
    }

    const action = getLibraryTopPlotAction(state, String(playerId));
    if (!action) {
      socket.emit('error', { code: 'NO_PLOT_ACTION', message: 'The top card of your library cannot be plotted right now.' });
      return;
    }

    const cost = String(action.cost || '').trim();
    let manaPayment: { tappedPermanents: string[]; paymentManaDelta: Record<string, number> } | null = null;
    if (cost && cost !== '{0}') {
      const payment = payManaCostWithAvailableSources(state, String(playerId), cost);
      if (!payment.ok) {
        socket.emit('error', { code: 'CANNOT_PAY_PLOT', message: payment.error || `Pay ${cost} to plot ${action.card?.name || 'that card'}.` });
        return;
      }
      manaPayment = {
        tappedPermanents: Array.isArray(payment.tappedPermanents) ? payment.tappedPermanents : [],
        paymentManaDelta: payment.paymentManaDelta && typeof payment.paymentManaDelta === 'object' ? payment.paymentManaDelta : {},
      };
    }

    const plotted = applyPlotLibraryTopCard(state, String(playerId));
    if (!plotted) {
      socket.emit('error', { code: 'PLOT_FAILED', message: 'Could not plot the top card of your library.' });
      return;
    }

    try {
      appendEvent(gameId, game.seq ?? 0, 'plotLibraryTop', {
        playerId,
        cardId: plotted.id,
        cost,
        card: plotted,
        manaPayment,
      });
    } catch (err) {
      debugWarn(1, 'appendEvent(plotLibraryTop) failed:', err);
    }

    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} plots ${plotted.name || 'a card'} from the top of their library.`,
      ts: Date.now(),
    });
    broadcastGame(io, game, gameId);
  } catch (err) {
    debugError(1, `plotLibraryTop error for game ${gameId}:`, err);
    socket.emit('error', { code: 'PLOT_FAILED', message: 'Could not plot the top card of your library.' });
  }
}
