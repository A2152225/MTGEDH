// server/src/state/modules/zones-handlers/zonesDrawReplacementTomorrowApply.ts
// Apply Tomorrow look-put-draw on a GameContext and optionally resume leftover
// draws. Public: applyTomorrowLookPutDrawOnContext.

import type { PlayerID } from '../../../../../shared/src/types.js';
import type { GameContext } from '../../context.js';
import { applyTomorrowLookPutDrawSynced } from './zonesDrawReplacementTomorrowQueue.js';
import { drawCards } from './zonesDrawCards.js';

export function applyTomorrowLookPutDrawOnContext(ctx: GameContext, event: {
  playerId: string;
  lookCount: number;
  chosenCardId?: string;
  bottomOrder?: string[];
  remainingDrawCountAfterChoice?: number;
  resumeRemaining?: boolean;
}): { applied: boolean; handCard?: any; bottomed: any[] } {
  const playerId = String(event?.playerId || '').trim();
  if (!playerId || !ctx) return { applied: false, bottomed: [] };

  const result = applyTomorrowLookPutDrawSynced(
    ctx,
    playerId,
    Math.max(0, Math.floor(Number(event?.lookCount || 0))),
    event?.chosenCardId,
    Array.isArray(event?.bottomOrder) ? event.bottomOrder : undefined,
  );
  if (typeof (ctx as any).bumpSeq === 'function') (ctx as any).bumpSeq();

  const remaining = Math.max(0, Math.floor(Number(event?.remainingDrawCountAfterChoice || 0)));
  if (event?.resumeRemaining !== false && remaining > 0) {
    drawCards(ctx, playerId as PlayerID, remaining, { skipEventPersistence: true });
  }
  return { applied: true, handCard: result.handCard, bottomed: result.bottomed };
}
