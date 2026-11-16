// server/src/state/modules/zones-handlers/zonesDrawReplacementArchmageQueue.ts
// Queue Archmage Ascension's optional "search your library instead of drawing"
// as a cancellable LIBRARY_SEARCH step. Public:
// queueArchmageAscensionSearchStep, autoQueueArchmageAscensionSearchReplacement,
// processPendingArchmageAscensionDraw, archmageAscensionIsReady.

import type { PlayerID } from '../../../../../shared/src/types.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager } from '../../resolution/index.js';
import { ResolutionStepType } from '../../resolution/types.js';
import { enqueueLibrarySearchStep } from '../triggerLibrarySearchUtils.js';
import { collectBatch93DrawReplacementSpecsFromState } from '../replacementBatch93DrawReplacements.js';
import { syncPlayerLibraryFromContext } from './zonesDrawReplacementLibrarySync.js';

export function archmageAscensionIsReady(state: any, playerId: string): { ready: boolean; spec?: any } {
  const pid = String(playerId || '').trim();
  if (!pid || !state) return { ready: false };
  const specs = collectBatch93DrawReplacementSpecsFromState(state).filter((s: any) =>
    s.effectId === 'optional-search-instead-of-draw' && String(s.sourceController) === pid,
  );
  const ready = specs.find((s: any) =>
    Number((s.metadata as any)?.questCounters ?? 0) >= Number((s.metadata as any)?.minQuest ?? 6),
  );
  return ready ? { ready: true, spec: ready } : { ready: false };
}

export function queueArchmageAscensionSearchStep(
  ctx: GameContext,
  playerId: string,
  metadata: any,
  remainingDrawCountAfterChoice: number,
): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;
  if ((ctx as any)._suppressArchmageAscensionReplacement === true) return false;

  const ready = archmageAscensionIsReady((ctx as any).state, playerId);
  if (!ready.ready) return false;

  syncPlayerLibraryFromContext(ctx, playerId);
  const lib = (ctx as any).state?.zones?.[playerId]?.library;
  if (!Array.isArray(lib) || lib.length === 0) return false;

  const sourceName = String(metadata?.sourceName || ready.spec?.sourceName || 'Archmage Ascension').trim() || 'Archmage Ascension';
  const sourceId = String(metadata?.sourcePermanentId || ready.spec?.sourcePermanentId || 'archmage-ascension').trim();
  const remaining = Math.max(0, Math.floor(Number(remainingDrawCountAfterChoice) || 0));

  (ctx as any).state = (ctx as any).state || {};
  (ctx as any).state.pendingArchmageAscensionDraw = {
    playerId,
    remaining,
    queued: true,
    sourceName,
    sourcePermanentId: sourceId,
  };

  const before = ResolutionQueueManager.getQueue(gameId).steps.slice();
  enqueueLibrarySearchStep(ctx, playerId as PlayerID, {
    description: 'You may search your library for a card, put it into your hand, then shuffle, instead of drawing.',
    searchFor: 'a card',
    destination: 'hand',
    sourceId,
    optional: true,
    source: sourceName,
    shuffleAfter: true,
    maxSelections: 1,
    minSelections: 0,
    reveal: true,
    persistLibrarySearchResolve: false,
  });
  const after = ResolutionQueueManager.getQueue(gameId).steps;
  const step = after.find((s: any) => !before.includes(s) && s?.type === ResolutionStepType.LIBRARY_SEARCH) || after[after.length - 1];
  if (!step || step.type !== ResolutionStepType.LIBRARY_SEARCH) {
    delete (ctx as any).state.pendingArchmageAscensionDraw;
    return false;
  }
  (step as any).archmageAscensionSearchInstead = true;
  (step as any).remainingDrawCountAfterChoice = remaining;
  (step as any).mandatory = false;
  return true;
}

export function autoQueueArchmageAscensionSearchReplacement(
  ctx: GameContext,
  playerId: string,
  metadata: any,
  remainingDrawCountAfterChoice: number,
): 'break' | 'none' {
  if ((ctx as any)._suppressArchmageAscensionReplacement === true) return 'none';
  const remaining = Math.max(0, Math.floor(Number(remainingDrawCountAfterChoice) || 0));
  const replayNextEventType = String((ctx as any)._replayNextEventType || '').trim();
  if ((ctx as any).isReplaying && replayNextEventType === 'archmageAscensionSearchInsteadResolve') {
    (ctx as any).state = (ctx as any).state || {};
    (ctx as any).state.pendingArchmageAscensionDraw = { playerId, remaining };
    return 'break';
  }
  if (!archmageAscensionIsReady((ctx as any).state, playerId).ready) return 'none';
  const queued = queueArchmageAscensionSearchStep(ctx, playerId, metadata, remaining);
  return queued ? 'break' : 'none';
}

export function processPendingArchmageAscensionDraw(_io: unknown, game: any, gameId: string): void {
  const pending = (game as any)?.state?.pendingArchmageAscensionDraw;
  if (!pending || typeof pending !== 'object') return;
  if (pending.queued === true) return;
  const playerId = String(pending.playerId || '').trim();
  if (!playerId) return;
  const queued = queueArchmageAscensionSearchStep(
    game as GameContext,
    playerId,
    { sourceName: pending.sourceName, sourcePermanentId: pending.sourcePermanentId },
    Math.max(0, Math.floor(Number(pending.remaining || 0))),
  );
  if (queued) pending.queued = true;
}
