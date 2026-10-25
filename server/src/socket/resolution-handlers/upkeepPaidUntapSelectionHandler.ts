/** TARGET_SELECTION with upkeepPaidUntapSelection (Magnetic Mountain): pay and untap, persist replay events. */
import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { resolveUpkeepPaidUntapSelection } from "../../state/modules/upkeepPaidUntapPrompt.js";
import { broadcastGame } from "../util.js";

export function handleUpkeepPaidUntapSelection(io: Server, game: any, gameId: string, step: any, playerId: string, selections: string[]): void {
  const r = resolveUpkeepPaidUntapSelection(game.state, step, String(playerId), selections);
  if (r.error) {
    io.to(gameId).emit('chat', { id: 'm_' + Date.now(), gameId, from: 'system', message: String(step?.sourceName || 'Upkeep') + ': ' + r.error, ts: Date.now() });
  } else if (r.untapped.length) {
    try {
      // One event carries sources tapped/sacrificed and the net pool delta (floating mana spent included).
      appendEvent(gameId, (game as any).seq ?? 0, 'upkeepPaidUntapResolve', {
        playerId: String(playerId),
        resolvedStepId: String(step?.id || ''),
        sourceName: String(step?.sourceName || ''),
        untapped: r.untapped,
        tappedForMana: r.tappedForMana,
        sacrificedForMana: r.sacrificedForMana || [],
        paymentManaDelta: r.paymentManaDelta || {},
      } as any);
    } catch { /* persistence best-effort */ }
    io.to(gameId).emit('chat', { id: 'm_' + Date.now(), gameId, from: 'system', message: String(step?.sourceName || 'Upkeep') + ': paid {' + r.paid + '} to untap ' + r.untapped.length + ' creature(s).', ts: Date.now() });
  }
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
}
