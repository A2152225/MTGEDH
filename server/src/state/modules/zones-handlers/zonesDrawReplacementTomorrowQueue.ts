// server/src/state/modules/zones-handlers/zonesDrawReplacementTomorrowQueue.ts
// Queue Tomorrow / Azami's Familiar look-put-draw as a PONDER_EFFECT step, or
// auto-apply when at most one card can be looked at. Public:
// autoApplyOrQueueTomorrowDrawReplacement, queueTomorrowDrawReplacementStep,
// processPendingTomorrowDraw, applyTomorrowLookPutDrawSynced.

import type { PlayerID } from '../../../../../shared/src/types.js';
import type { GameContext } from '../../context.js';
import { uid } from '../../utils.js';
import { ResolutionQueueManager } from '../../resolution/index.js';
import { ResolutionStepType } from '../../resolution/types.js';
import { applyTomorrowLookPutDraw } from '../replacementBatch91DrawReplacements.js';
import { syncPlayerLibraryFromContext, writePlayerLibraryToContext } from './zonesDrawReplacementLibrarySync.js';

export function applyTomorrowLookPutDrawSynced(
  ctx: GameContext,
  playerId: string,
  lookCount: number,
  chosenCardId?: string,
  bottomOrder?: string[],
): { handCard?: any; bottomed: any[] } {
  syncPlayerLibraryFromContext(ctx, playerId);
  const result = applyTomorrowLookPutDraw(
    (ctx as any).state,
    playerId,
    lookCount,
    chosenCardId,
    Array.isArray(bottomOrder) ? bottomOrder : undefined,
  );
  const nextLib = Array.isArray((ctx as any).state?.zones?.[playerId]?.library)
    ? (ctx as any).state.zones[playerId].library
    : [];
  writePlayerLibraryToContext(ctx, playerId, nextLib);
  if ((ctx as any).state) delete (ctx as any).state.pendingTomorrowDraw;
  return result;
}

function snapshotTopCards(ctx: GameContext, playerId: string, lookCount: number): any[] {
  const lib = syncPlayerLibraryFromContext(ctx, playerId);
  const n = Math.min(Math.max(0, Math.floor(Number(lookCount) || 0)), lib.length);
  return lib.slice(0, n);
}

export function queueTomorrowDrawReplacementStep(
  ctx: GameContext,
  playerId: string,
  metadata: any,
  remainingDrawCountAfterChoice: number,
): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;

  const lookAtLibraryTop = Math.max(0, Math.floor(Number(metadata?.lookAtLibraryTop || metadata?.look || 3)));
  const cards = snapshotTopCards(ctx, playerId, lookAtLibraryTop);
  if (cards.length <= 1) return false;

  const sourceName = String(metadata?.sourceName || "Tomorrow, Azami's Familiar").trim() || "Tomorrow, Azami's Familiar";
  (ctx as any).state = (ctx as any).state || {};
  (ctx as any).state.pendingTomorrowDraw = {
    playerId,
    lookAtLibraryTop,
    remaining: Math.max(0, Math.floor(Number(remainingDrawCountAfterChoice) || 0)),
    queued: true,
  };

  ResolutionQueueManager.addStep(gameId, {
    id: uid('tomorrow_draw'),
    type: ResolutionStepType.PONDER_EFFECT,
    playerId: playerId as PlayerID,
    sourceId: String(metadata?.sourcePermanentId || 'tomorrow'),
    sourceName,
    description: `Look at the top ${cards.length} cards of your library. Put one into your hand and the rest on the bottom in any order.`,
    mandatory: true,
    cards,
    variant: 'anticipate',
    cardCount: cards.length,
    drawAfter: false,
    mayShuffleAfter: false,
    tomorrowDrawReplacement: true,
    lookAtLibraryTop,
    remainingDrawCountAfterChoice: Math.max(0, Math.floor(Number(remainingDrawCountAfterChoice) || 0)),
    targetPlayerId: playerId,
  } as any);
  return true;
}

/**
 * Returns 'break' when a prompt was queued (or replay should wait for the
 * resolve event), 'continue' when this draw was auto-applied and the loop
 * should try the next card, or 'none' when the replacement should be ignored.
 */
export function autoApplyOrQueueTomorrowDrawReplacement(
  ctx: GameContext,
  playerId: string,
  metadata: any,
  remainingDrawCountAfterChoice: number,
): 'break' | 'continue' | 'none' {
  const lookAtLibraryTop = Math.max(0, Math.floor(Number(metadata?.lookAtLibraryTop || metadata?.look || 3)));
  const remaining = Math.max(0, Math.floor(Number(remainingDrawCountAfterChoice) || 0));
  const replayNextEventType = String((ctx as any)._replayNextEventType || '').trim();
  if ((ctx as any).isReplaying && replayNextEventType === 'tomorrowLookPutDrawResolve') {
    (ctx as any).state = (ctx as any).state || {};
    (ctx as any).state.pendingTomorrowDraw = { playerId, lookAtLibraryTop, remaining };
    return 'break';
  }

  const cards = snapshotTopCards(ctx, playerId, lookAtLibraryTop);
  if (cards.length <= 1) {
    applyTomorrowLookPutDrawSynced(ctx, playerId, lookAtLibraryTop, cards[0] ? String(cards[0]?.id || cards[0]?.card?.id || '') : undefined);
    return 'continue';
  }

  const queued = queueTomorrowDrawReplacementStep(ctx, playerId, metadata, remaining);
  if (queued) return 'break';

  applyTomorrowLookPutDrawSynced(ctx, playerId, lookAtLibraryTop);
  return 'continue';
}

export function processPendingTomorrowDraw(_io: unknown, game: any, gameId: string): void {
  const pending = (game as any)?.state?.pendingTomorrowDraw;
  if (!pending || typeof pending !== 'object') return;
  if (pending.queued === true) return;
  const playerId = String(pending.playerId || '').trim();
  if (!playerId) return;
  const queued = queueTomorrowDrawReplacementStep(
    game as GameContext,
    playerId,
    { lookAtLibraryTop: pending.lookAtLibraryTop, sourceName: pending.sourceName, sourcePermanentId: pending.sourcePermanentId },
    Math.max(0, Math.floor(Number(pending.remaining || 0))),
  );
  if (queued) pending.queued = true;
}
