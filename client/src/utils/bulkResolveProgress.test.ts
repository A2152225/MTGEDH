import { describe, expect, it } from 'vitest';
import {
  BULK_RESOLVE_PROGRESS_TIMEOUT_MS,
  bulkResolveProgressFraction,
  bulkResolveProgressLabel,
  expireBulkResolveProgress,
  reduceBulkResolveProgress,
} from './bulkResolveProgress';

const ev = (phase: any, done: number, runId = 'r1', extra: any = {}) => ({
  gameId: 'g1', runId, sourceName: "Cathars' Crusade", done, total: 100, phase, ...extra,
});

describe('bulk resolve progress', () => {
  it('tracks start/progress and clears on end', () => {
    let s = reduceBulkResolveProgress(null, ev('start', 1), 0, 'g1');
    s = reduceBulkResolveProgress(s, ev('progress', 37), 10, 'g1');
    expect(bulkResolveProgressLabel(s!)).toBe("Resolving Cathars' Crusade 37/100");
    expect(bulkResolveProgressFraction(s!)).toBeCloseTo(0.37);
    expect(reduceBulkResolveProgress(s, ev('end', 40, 'r1', { reason: 'player_can_respond' }), 20, 'g1')).toBeNull();
  });

  it('ignores other games, clamps values and keeps the current run on stale events', () => {
    const s = reduceBulkResolveProgress(null, ev('start', 0), 0, 'g1');
    expect(reduceBulkResolveProgress(s, { ...ev('progress', 50), gameId: 'g2' }, 1, 'g1')).toBe(s);
    expect(reduceBulkResolveProgress(s, ev('end', 5, 'old'), 2, 'g1')).toBe(s);
    expect(reduceBulkResolveProgress(s, ev('progress', 9, 'old'), 3, 'g1')).toBe(s);
    expect(reduceBulkResolveProgress(s, ev('progress', 500), 4, 'g1')!.done).toBe(100);
    expect(reduceBulkResolveProgress(s, null, 5, 'g1')).toBe(s);
  });

  it('expires after the safety timeout without events', () => {
    const s = reduceBulkResolveProgress(null, ev('start', 0), 1000, 'g1');
    expect(expireBulkResolveProgress(s, 1000 + BULK_RESOLVE_PROGRESS_TIMEOUT_MS)).toBe(s);
    expect(expireBulkResolveProgress(s, 1001 + BULK_RESOLVE_PROGRESS_TIMEOUT_MS)).toBeNull();
  });
});
