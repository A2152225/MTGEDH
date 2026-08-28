/**
 * resolution/resolutionQueueGameIds.ts
 *
 * Origin parent: ResolutionQueue / priority / auto-pass guards.
 * Cluster moved: canonical gameId lookup so Smart Pass cannot drain the stack
 * under a prompt that was queued on state.id while ctx.gameId is missing or
 * the sentinel "unknown".
 * Public entry symbols: collectResolutionQueueGameIds,
 * collectResolutionQueueGameIdsFromContext, bindCanonicalResolutionQueueGameId,
 * contextHasBlockingNonPaymentResolutionSteps, contextHasPendingResolutionSteps,
 * contextPendingResolutionSummary.
 */

import { ResolutionQueueManager } from './ResolutionQueueManager.js';

const INVALID_RESOLUTION_QUEUE_GAME_IDS = new Set(['', 'unknown', 'undefined', 'null']);

export function isInvalidResolutionQueueGameId(gameId: unknown): boolean {
  const id = String(gameId || '').trim();
  if (!id) return true;
  return INVALID_RESOLUTION_QUEUE_GAME_IDS.has(id.toLowerCase());
}

export function collectResolutionQueueGameIds(...candidates: unknown[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const id = String(candidate || '').trim();
    if (isInvalidResolutionQueueGameId(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function collectResolutionQueueGameIdsFromContext(ctx: any, extra?: unknown): string[] {
  const state = ctx?.state;
  return collectResolutionQueueGameIds(
    extra,
    ctx?.gameId,
    ctx?.id,
    state?.id,
    state?.gameId,
  );
}

/**
 * Prefer a real game id over the "unknown" sentinel. When the context still
 * has no usable id, copy the first valid candidate onto ctx.gameId so later
 * queue lookups (passPriority, exitResolutionMode) hit the same queue that
 * queueResolveTopOfStackPrompt wrote to.
 */
export function bindCanonicalResolutionQueueGameId(ctx: any, extra?: unknown): string {
  const ids = collectResolutionQueueGameIdsFromContext(ctx, extra);
  const id = ids[0] || '';
  if (id && ctx && typeof ctx === 'object') {
    if (isInvalidResolutionQueueGameId(ctx.gameId)) {
      ctx.gameId = id;
    }
  }
  return id;
}

export function contextHasBlockingNonPaymentResolutionSteps(ctx: any, extra?: unknown): boolean {
  return collectResolutionQueueGameIdsFromContext(ctx, extra)
    .some((id) => ResolutionQueueManager.hasBlockingNonPaymentResolutionSteps(id));
}

export function contextHasPendingResolutionSteps(ctx: any, extra?: unknown): boolean {
  return collectResolutionQueueGameIdsFromContext(ctx, extra)
    .some((id) => ResolutionQueueManager.hasPendingSteps(id));
}

export function contextPendingResolutionSummary(ctx: any, extra?: unknown) {
  const ids = collectResolutionQueueGameIdsFromContext(ctx, extra);
  for (const id of ids) {
    const summary = ResolutionQueueManager.getPendingSummary(id);
    if (summary.hasPending) return summary;
  }
  return ResolutionQueueManager.getPendingSummary(ids[0] || '');
}
