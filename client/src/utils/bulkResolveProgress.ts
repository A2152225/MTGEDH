/**
 * Client state for the server's "identicalTriggerBulkProgress" events (bulk resolution
 * of identical triggers). Pure helpers so the badge stays trivial and testable.
 */
export type BulkResolveProgressEvent = {
  gameId?: string;
  runId?: string;
  sourceName?: string;
  done?: number;
  total?: number;
  phase?: 'start' | 'progress' | 'end';
  reason?: string;
};

export type BulkResolveProgressState = {
  runId: string;
  sourceName: string;
  done: number;
  total: number;
  lastEventAt: number;
} | null;

/** Clear the badge if no event arrived for this long (lost end event, disconnect). */
export const BULK_RESOLVE_PROGRESS_TIMEOUT_MS = 10000;

export function reduceBulkResolveProgress(
  state: BulkResolveProgressState,
  event: BulkResolveProgressEvent | null | undefined,
  now: number,
  gameId?: string | null,
): BulkResolveProgressState {
  if (!event || typeof event !== 'object') return state;
  if (gameId && event.gameId && event.gameId !== gameId) return state;
  const runId = String(event.runId || '');
  if (event.phase === 'end') {
    return !state || !runId || state.runId === runId ? null : state;
  }
  if (event.phase !== 'start' && event.phase !== 'progress') return state;
  // A late progress event of an older run must not replace the current one.
  if (event.phase === 'progress' && state && runId && state.runId !== runId && state.lastEventAt > now - 1000) return state;
  const total = Math.max(0, Number(event.total) || 0);
  const done = Math.max(0, Math.min(total, Number(event.done) || 0));
  if (total <= 0) return null;
  return { runId, sourceName: String(event.sourceName || 'triggers'), done, total, lastEventAt: now };
}

export function expireBulkResolveProgress(
  state: BulkResolveProgressState,
  now: number,
  timeoutMs: number = BULK_RESOLVE_PROGRESS_TIMEOUT_MS,
): BulkResolveProgressState {
  if (!state) return null;
  return now - state.lastEventAt > timeoutMs ? null : state;
}

export function bulkResolveProgressLabel(state: NonNullable<BulkResolveProgressState>): string {
  return `Resolving ${state.sourceName} ${state.done}/${state.total}`;
}

export function bulkResolveProgressFraction(state: NonNullable<BulkResolveProgressState>): number {
  return state.total > 0 ? Math.max(0, Math.min(1, state.done / state.total)) : 0;
}
