/**
 * Regression for probe bleed: a timed-out / aborted advance must not leave the
 * worker's fake-timer clock or AI schedules in a state that breaks the next it().
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceLiveGame } from './helpers/liveGameHarness.js';
import { cleanupGameAI } from '../src/socket/ai.js';

function stubGame(seq = 1): any {
  return {
    seq,
    state: {
      turnNumber: 1,
      phase: 'precombatMain',
      step: 'MAIN1',
      stack: [],
      players: [{ id: 'p1', life: 40 }],
      gameOver: false,
    },
  };
}

describe('live harness isolation across sequential cases', () => {
  afterEach(() => {
    try {
      vi.clearAllTimers();
    } catch {
      // ignore
    }
    vi.useRealTimers();
  });

  it('first case aborts and tears down without poisoning the next fake-timer session', async () => {
    const gameId = 'isolation-bleed-a';
    vi.useFakeTimers({
      toFake: [
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'setImmediate', 'clearImmediate', 'Date',
      ],
    });

    const abort = new AbortController();
    const first = advanceLiveGame(stubGame(), {
      maxTicks: 10_000,
      tickMs: 100,
      maxTurns: 90,
      maxStagnantTicks: 10_000,
      minStagnantWallMs: 60_000,
      softStop: true,
      label: gameId,
      signal: abort.signal,
    });
    queueMicrotask(() => abort.abort());
    expect((await first).endReason).toBe('aborted');

    cleanupGameAI(gameId);
    vi.clearAllTimers();
    vi.useRealTimers();

    // Second case: re-enter fake timers. If the first case left the clock restored
    // incorrectly, advanceTimersByTimeAsync throws "timers APIs are not mocked".
    vi.useFakeTimers({
      toFake: [
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'setImmediate', 'clearImmediate', 'Date',
      ],
    });

    const abort2 = new AbortController();
    abort2.abort();
    const second = await advanceLiveGame(stubGame(2), {
      maxTicks: 100,
      tickMs: 100,
      maxTurns: 90,
      maxStagnantTicks: 100,
      minStagnantWallMs: 60_000,
      softStop: true,
      label: 'isolation-bleed-b',
      signal: abort2.signal,
    });
    expect(second.endReason).toBe('aborted');

    // And advancing timers still works under the second fake session
    // (would throw "timers APIs are not mocked" if the first case poisoned the clock).
    await vi.advanceTimersByTimeAsync(500);
  });
});
