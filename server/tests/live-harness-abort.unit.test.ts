/**
 * Ensures advanceLiveGame stops when aborted so a timed-out vitest case cannot
 * keep advancing fake timers into the next test in the same worker.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceLiveGame } from './helpers/liveGameHarness.js';

describe('advanceLiveGame abort isolation', () => {
  afterEach(() => {
    try {
      vi.clearAllTimers();
    } catch {
      // ignore
    }
    vi.useRealTimers();
  });

  it('exits on an already-aborted signal without running the tick loop', async () => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'setImmediate', 'clearImmediate', 'Date',
      ],
    });

    const game: any = {
      seq: 1,
      state: {
        turnNumber: 1,
        phase: 'precombatMain',
        step: 'MAIN1',
        stack: [],
        players: [{ id: 'p1', life: 40 }],
        gameOver: false,
      },
    };

    const abort = new AbortController();
    abort.abort();

    const result = await advanceLiveGame(game, {
      maxTicks: 10_000,
      tickMs: 1_000,
      maxTurns: 90,
      maxStagnantTicks: 10_000,
      minStagnantWallMs: 60_000,
      softStop: true,
      label: 'abort-unit',
      signal: abort.signal,
    });

    expect(result.endReason).toBe('aborted');
    expect(result.turns).toBe(1);
  });

  it('stops after abort mid-run without requiring the maxTicks budget', async () => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'setImmediate', 'clearImmediate', 'Date',
      ],
    });

    const game: any = {
      seq: 1,
      state: {
        turnNumber: 1,
        phase: 'precombatMain',
        step: 'MAIN1',
        stack: [],
        players: [{ id: 'p1', life: 40 }],
        gameOver: false,
      },
    };

    const abort = new AbortController();
    // Abort on the next macrotask so the first tick can start, then stop.
    const advancePromise = advanceLiveGame(game, {
      maxTicks: 10_000,
      tickMs: 50,
      maxTurns: 90,
      maxStagnantTicks: 10_000,
      minStagnantWallMs: 60_000,
      softStop: true,
      label: 'abort-unit-mid',
      signal: abort.signal,
    });
    queueMicrotask(() => abort.abort());

    const result = await advancePromise;
    expect(result.endReason).toBe('aborted');
  });
});
