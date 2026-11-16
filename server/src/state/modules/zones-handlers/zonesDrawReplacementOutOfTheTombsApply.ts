// server/src/state/modules/zones-handlers/zonesDrawReplacementOutOfTheTombsApply.ts
// Apply an Out of the Tombs empty-library draw choice on a GameContext and
// resume leftover draws. Public: applyOutOfTheTombsDrawOnContext.

import type { PlayerID } from '../../../../../shared/src/types.js';
import type { GameContext } from '../../context.js';
import { applyOutOfTheTombsEmptyLibraryDraw } from '../replacementBatch92DrawReplacements.js';
import { drawCards } from './zonesDrawCards.js';

export function applyOutOfTheTombsDrawOnContext(ctx: GameContext, event: {
  playerId: string;
  chosenCardId?: string;
  remainingDrawCountAfterChoice?: number;
  resumeRemaining?: boolean;
}): { applied: boolean; needsChoice: boolean; lost: boolean; returned?: any } {
  const playerId = String(event?.playerId || '').trim();
  const empty = { applied: false, needsChoice: false, lost: false };
  if (!playerId || !ctx) return empty;

  const result = applyOutOfTheTombsEmptyLibraryDraw(
    (ctx as any).state,
    playerId,
    0,
    event?.chosenCardId,
  );
  if ((ctx as any).state) delete (ctx as any).state.pendingOutOfTheTombsDraw;
  if (typeof (ctx as any).bumpSeq === 'function') (ctx as any).bumpSeq();

  const remaining = Math.max(0, Math.floor(Number(event?.remainingDrawCountAfterChoice || 0)));
  if (result.applied && event?.resumeRemaining !== false && remaining > 0) {
    drawCards(ctx, playerId as PlayerID, remaining, { skipEventPersistence: true });
  }
  return result;
}
