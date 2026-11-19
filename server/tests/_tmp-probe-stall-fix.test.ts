/**
 * Capture stall subtype for known v2 gate stall shards.
 *
 * Isolation: each shard uses a unique gameId, AbortSignal stops advanceLiveGame on
 * teardown, and cleanupLiveGame + clearAllTimers run before useRealTimers so a
 * vitest timeout cannot leave fake-timer AI schedules firing into the next shard.
 *
 * Parallel: run via `node scripts/ai-stall-probe-parallel.mjs` (one process per shard).
 * Do not concurrent-run multiple shards in one vitest worker (fake timers are global).
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initDb } from '../src/db/index.js';
import { initializeAIResolutionHandler } from '../src/socket/resolution.js';
import { seedAIRandom } from '../../rules-engine/src/aiRandom.js';
import {
  advanceLiveGame,
  cleanupLiveGame,
  createNoopIo,
  prepareLiveGame,
  type DeckSeatSpec,
} from './helpers/liveGameHarness.js';
import {
  drawPodDecks,
  listSelfPlayPreconPool,
  loadSelfPlayDeckLines,
} from './helpers/preconPool.js';
import { mainPhaseActionsTaken } from '../src/socket/ai-handlers/aiMainPhaseActionBudget.js';
import { getSeatBrain } from '../src/socket/ai-handlers/aiBrain.js';

/** Real wall clock — vitest fakes global Date inside each shard. */
const WallDate = Date;

const SEED = 7000;
const SHARDS = (process.env.PROBE_STALL_SHARDS || '2,1,19,43')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));

function linesFromDeck(deck: { id: string }): string[] {
  const parsed = loadSelfPlayDeckLines(deck as any);
  const names: string[] = [];
  for (const line of parsed) {
    const count = Math.max(1, Number(line.count) || 1);
    for (let i = 0; i < count; i++) names.push(line.name);
  }
  return names;
}

function installErrorCapture(): { errors: string[]; warnings: string[]; restore: () => void } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const format = (args: unknown[]) =>
    args
      .map((a) => {
        if (a instanceof Error) return a.stack || a.message;
        if (typeof a === 'string') return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');
  const origError = console.error;
  const origWarn = console.warn;
  console.error = (...args: unknown[]) => {
    const msg = format(args);
    if (msg && !/\[live-harness:/.test(msg)) errors.push(`[error] ${msg}`.slice(0, 500));
    origError.apply(console, args as any);
  };
  console.warn = (...args: unknown[]) => {
    const text = String(args[0] ?? '');
    const msg = format(args);
    // Intentional planner skips are warnings, not failures.
    if (/attack planner skipped|attack planner too slow|turn planner failed/i.test(text)) {
      warnings.push(`[warn] ${msg}`.slice(0, 500));
    } else if (/\[AI\]|oracleIR|Force-mark|Attack declaration|tick-timeout|Error|timed out/i.test(text)) {
      errors.push(`[warn] ${msg}`.slice(0, 500));
    }
    origWarn.apply(console, args as any);
  };
  return {
    errors,
    warnings,
    restore: () => {
      console.error = origError;
      console.warn = origWarn;
    },
  };
}

function writeProbeResult(payload: Record<string, unknown>): void {
  const outPath = process.env.PROBE_STALL_OUT;
  if (!outPath) return;
  try {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  } catch (err) {
    console.warn('[probe-stall] failed to write PROBE_STALL_OUT', err);
  }
}

describe('v2 stall subtype probe', () => {
  beforeAll(async () => {
    await initDb();
    initializeAIResolutionHandler(createNoopIo() as any);
  });

  afterEach(() => {
    try {
      vi.clearAllTimers();
    } catch {
      // ignore
    }
    vi.useRealTimers();
    seedAIRandom(null);
  });

  afterAll(() => {
    seedAIRandom(null);
  });

  for (const gameIndex of SHARDS) {
    it(`shard ${gameIndex}`, async () => {
      process.env.AI_SELFPLAY_CHALLENGER = 'v2';
      process.env.AI_SELFPLAY_BASELINE = 'v1';
      delete process.env.AI_BRAIN;
      process.env.LIVE_PRECON_PROGRESS_LOG = '1';

      vi.useFakeTimers({
        toFake: [
          'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
          'setImmediate', 'clearImmediate', 'Date',
        ],
      });

      const abort = new AbortController();
      const capture = installErrorCapture();
      let prepared: Awaited<ReturnType<typeof prepareLiveGame>> | null = null;
      const startedAt = new WallDate().toISOString();
      const startedHr = process.hrtime.bigint();
      let gameId = `probe-stall-${SEED}-${gameIndex}`;

      console.log(`[probe-stall] START gameIndex=${gameIndex} at=${startedAt}`);

      try {
        const pool = listSelfPlayPreconPool();
        const podIndex = Math.floor(gameIndex / 4);
        const rotation = gameIndex % 4;
        const gameSeed = (SEED + gameIndex * 9973) >>> 0;
        seedAIRandom((SEED + podIndex * 7919) >>> 0);
        const podDecks = drawPodDecks(pool, 4);
        seedAIRandom(gameSeed);
        const seatOrder = [0, 1, 2, 3].map((i) => (i + rotation) % 4);
        gameId = `probe-stall-${SEED}-${gameIndex}-${podIndex}-${rotation}`;
        console.log(
          `[probe-stall] READY gameIndex=${gameIndex} gameId=${gameId} seed=${gameSeed} pod=${podIndex} rot=${rotation}`,
        );

        const seats: DeckSeatSpec[] = seatOrder.map((deckIdx, seatIdx) => {
          const deck = podDecks[deckIdx];
          return {
            deckId: deck.id,
            cardNames: linesFromDeck(deck),
            settings: {
              playerName: `${deck.deckName}`.slice(0, 40),
              aiStrategy: 'aggressive',
              difficulty: 0.5,
              brain: seatIdx === 0 ? 'v2' : 'v1',
            },
          };
        });

        prepared = await prepareLiveGame({ gameId, seats, seed: gameSeed, seedAI: true });
        const MAX_TURNS = 90;
        const advanced = await advanceLiveGame(prepared.game, {
          maxTicks: Math.max(200, MAX_TURNS * 25),
          tickMs: 2_000,
          maxTurns: MAX_TURNS,
          maxStagnantTicks: 40,
          minStagnantWallMs: 15_000,
          maxNoTurnAdvanceMs: Math.max(60_000, Math.min(180_000, MAX_TURNS * 2_000)),
          // Large late-game boards often run ~20–25s/turn wall; 15s/turn falsely stalls mid-progress.
          maxWallClockMs: Math.max(180_000, MAX_TURNS * 30_000),
          maxTickWallClockMs: 180_000,
          softStop: true,
          label: gameId,
          signal: abort.signal,
          stopWhen: (game) => Boolean((game.state as any).gameOver),
        });

        const st = prepared.game.state as any;
        const prio = String(st.priority || '');
        const turnPlayer = String(st.turnPlayer || '');
        const endedAt = new WallDate().toISOString();
        const ms = Math.round(Number(process.hrtime.bigint() - startedHr) / 1e6);
        const payload = {
          gameIndex,
          gameId,
          startedAt,
          endedAt,
          ms,
          endReason: advanced.endReason,
          turns: advanced.turns,
          phase: st.phase,
          step: st.step,
          priorityBrain: getSeatBrain(prepared.game, prio),
          turnPlayerBrain: getSeatBrain(prepared.game, turnPlayer),
          mainActions: mainPhaseActionsTaken(prepared.game, prio),
          stackSize: Array.isArray(st.stack) ? st.stack.length : 0,
          bf: Array.isArray(st.battlefield) ? st.battlefield.length : 0,
          seq: prepared.game.seq,
          attackersDeclaredBy: st.attackersDeclaredBy,
          errors: capture.errors.slice(0, 50),
          warnings: capture.warnings.slice(0, 50),
          errorCount: capture.errors.length,
          warningCount: capture.warnings.length,
        };

        console.log(JSON.stringify(payload, null, 2));
        console.log(
          `[probe-stall] END gameIndex=${gameIndex} gameId=${gameId} at=${endedAt} ms=${ms}` +
            ` endReason=${advanced.endReason} turns=${advanced.turns}` +
            ` errors=${capture.errors.length} warnings=${capture.warnings.length}`,
        );
        if (capture.errors.length > 0) {
          console.log(`[probe-stall] ERRORS gameIndex=${gameIndex} (showing up to 12):`);
          for (const err of capture.errors.slice(0, 12)) {
            console.log(`  ${err}`);
          }
        }
        if (capture.warnings.length > 0) {
          console.log(`[probe-stall] WARNINGS gameIndex=${gameIndex} (showing up to 8):`);
          for (const w of capture.warnings.slice(0, 8)) console.log(`  ${w}`);
        }
        writeProbeResult(payload);

        expect(['stall', 'turn-limit', 'win', 'aborted']).toContain(advanced.endReason);
      } catch (err) {
        const endedAt = new WallDate().toISOString();
        const ms = Math.round(Number(process.hrtime.bigint() - startedHr) / 1e6);
        const message = err instanceof Error ? err.stack || err.message : String(err);
        capture.errors.push(`[throw] ${message}`.slice(0, 500));
        const payload = {
          gameIndex,
          gameId,
          startedAt,
          endedAt,
          ms,
          endReason: 'error',
          error: message.slice(0, 500),
          errors: capture.errors.slice(0, 50),
          warnings: capture.warnings.slice(0, 50),
          errorCount: capture.errors.length,
          warningCount: capture.warnings.length,
        };
        console.log(`[probe-stall] END gameIndex=${gameIndex} at=${endedAt} ms=${ms} endReason=error`);
        console.log(`[probe-stall] ERRORS gameIndex=${gameIndex}:`);
        for (const e of capture.errors.slice(0, 12)) console.log(`  ${e}`);
        writeProbeResult(payload);
        throw err;
      } finally {
        abort.abort();
        capture.restore();
        if (prepared) {
          try {
            await cleanupLiveGame(prepared);
          } catch {
            // best-effort
          }
        }
        try {
          vi.clearAllTimers();
        } catch {
          // ignore
        }
        vi.useRealTimers();
      }
      // Must exceed advanceLiveGame maxWallClockMs (MAX_TURNS*30s ≈ 45m) plus cleanup.
      // At 900s vitest tore down fake timers mid-tick → false "timers APIs are not mocked" stalls.
    }, 2_800_000);
  }
});
