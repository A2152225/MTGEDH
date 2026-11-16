// server/src/state/modules/apply-event-handlers/applyEventCirclingVulturesDiscardReplay.ts
// Replay hook for circlingVulturesDiscard. Live path already discarded and
// appended the event; applyEvent runs on replay only.

import type { GameContext } from '../context.js';
import { applyCirclingVulturesDiscard } from '../circlingVulturesDiscardAction.js';

export function applyCirclingVulturesDiscardEvents(
  ctx: GameContext,
  event: any,
  payloadArg?: any,
): boolean {
  const eventType = typeof event === 'string' ? event : String(event?.type || event?.eventType || '');
  const payload = payloadArg !== undefined ? payloadArg : (event?.payload ?? event);
  if (eventType !== 'circlingVulturesDiscard') return false;
  applyCirclingVulturesDiscard(ctx, {
    playerId: String(payload?.playerId || '').trim(),
    cardId: String(payload?.cardId || payload?.card?.id || '').trim(),
  });
  return true;
}
