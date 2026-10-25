/** TARGET_SELECTION with untapCapChoice (Winter Orb / Imi Statue): untap the chosen permanents, persist replay event. */
import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { resolveUntapCapChoice } from "../../state/modules/untapStepCapChoice.js";
import { queueBecomesUntappedTriggers } from "../../state/modules/triggers/tap-untap.js";
import { broadcastGame } from "../util.js";

export function handleUntapCapChoiceSelection(io: Server, game: any, gameId: string, step: any, playerId: string, selections: string[]): void {
  const untapped = resolveUntapCapChoice(game.state, step, String(playerId), selections, (perm) => queueBecomesUntappedTriggers(game as any, perm));
  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'untapCapChoiceResolve', {
      playerId: String(playerId),
      resolvedStepId: String(step?.id || ''),
      untapped,
    } as any);
  } catch { /* persistence best-effort */ }
  io.to(gameId).emit('chat', { id: 'm_' + Date.now(), gameId, from: 'system', message: 'Untap step: untapped ' + untapped.length + ' capped permanent(s).', ts: Date.now() });
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
}
