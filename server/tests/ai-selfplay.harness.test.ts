/**
 * Headless four-bot self-play harness (P0-3).
 *
 * Skipped unless AI_SELFPLAY_GAMES is set.
 * Pool: baked precon catalogue (mtgjson, cardCount 100) — not the 12 text decks.
 *
 * Env:
 *   AI_SELFPLAY_GAMES, AI_SELFPLAY_SEED, AI_SELFPLAY_OUT, AI_SELFPLAY_SHARD (i/n),
 *   AI_SELFPLAY_MAX_TURNS (default 60), AI_SELFPLAY_CHALLENGER (default v0),
 *   AI_POSITIONS_FILE (optional P1-2 feature log), AI_POSITIONS_VERIFY=1 (public-only assert)
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
  type SelfPlayDeckMeta,
} from './helpers/preconPool.js';

const GAMES = Number(process.env.AI_SELFPLAY_GAMES || 0);
const SEED = Number(process.env.AI_SELFPLAY_SEED || 1);
const OUT = process.env.AI_SELFPLAY_OUT || '';
const POSITIONS_FILE = process.env.AI_POSITIONS_FILE || '';
const MAX_TURNS = Number(process.env.AI_SELFPLAY_MAX_TURNS || 60);
const CHALLENGER = String(process.env.AI_SELFPLAY_CHALLENGER || 'v0');
const SHARD = String(process.env.AI_SELFPLAY_SHARD || '0/1');

function parseShard(spec: string): { index: number; count: number } {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(String(spec || '0/1'));
  if (!match) return { index: 0, count: 1 };
  const index = Math.max(0, Number(match[1]) || 0);
  const count = Math.max(1, Number(match[2]) || 1);
  return { index: index % count, count };
}

function linesFromDeck(deck: SelfPlayDeckMeta): string[] {
  const parsed = loadSelfPlayDeckLines(deck);
  const names: string[] = [];
  for (const line of parsed) {
    const count = Math.max(1, Number(line.count) || 1);
    for (let i = 0; i < count; i++) names.push(line.name);
  }
  return names;
}

function appendResult(line: object): void {
  if (!OUT) return;
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.appendFileSync(OUT, `${JSON.stringify(line)}\n`);
}

const describeSelfPlay = GAMES > 0 ? describe : describe.skip;

describeSelfPlay('AI self-play harness (P0-3)', () => {
  beforeAll(async () => {
    await initDb();
    initializeAIResolutionHandler(createNoopIo() as any);
  });

  afterAll(() => {
    seedAIRandom(null);
  });

  it(`runs ${GAMES} four-bot games from the precon catalogue`, async () => {
    // Fake only scheduling timers + Date. Do NOT fake hrtime/performance: advanceLiveGame
    // stall guards (maxNoTurnAdvanceMs, minStagnantWallMs, maxWallClockMs) use real wall
    // clock via process.hrtime.bigint(). Vitest's default toFake list includes hrtime, which
    // made those guards fire on simulated tick time and false-stalled mid-game (~28% stalls).
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'Date',
      ],
    });
    const pool = listSelfPlayPreconPool();
    expect(pool.length).toBeGreaterThanOrEqual(4);

    const { index: shardIndex, count: shardCount } = parseShard(SHARD);
    const results: Array<Record<string, unknown>> = [];
    // Baseline shards append to a fresh file, but truncate here too so a
    // double-invoked vitest worker cannot leave two rows for one gameId.
    if (OUT) {
      fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
      fs.writeFileSync(OUT, '');
    }
    if (POSITIONS_FILE) {
      fs.mkdirSync(path.dirname(path.resolve(POSITIONS_FILE)), { recursive: true });
      fs.writeFileSync(POSITIONS_FILE, '');
    }

    try {
      for (let gameIndex = 0; gameIndex < GAMES; gameIndex++) {
        if (gameIndex % shardCount !== shardIndex) continue;

        const podIndex = Math.floor(gameIndex / 4);
        const rotation = gameIndex % 4;
        // Reseed from a derived value so each game is independent but reproducible.
        const gameSeed = (SEED + gameIndex * 9973) >>> 0;
        seedAIRandom(gameSeed);

        // Pod decks: stable for the four rotations of a pod.
        seedAIRandom((SEED + podIndex * 7919) >>> 0);
        const podDecks = drawPodDecks(pool, 4);
        seedAIRandom(gameSeed);

        const seatOrder = [0, 1, 2, 3].map((i) => (i + rotation) % 4);
        const decksForSeats = seatOrder.map((i) => podDecks[i]);
        const gameId = `selfplay-${SEED}-${podIndex}-${rotation}`;

        const seats: DeckSeatSpec[] = decksForSeats.map((deck, seatIdx) => {
          // AI_BRAIN (if set) applies to every seat — needed for shadow reproduction.
          // Otherwise seat 0 is the challenger and the rest stay v0.
          const envBrain = String(process.env.AI_BRAIN || '').trim();
          const brain = envBrain || (seatIdx === 0 ? CHALLENGER : 'v0');
          return {
            deckId: deck.id,
            cardNames: linesFromDeck(deck),
            settings: {
              playerName: `${deck.deckName}`.slice(0, 40),
              aiStrategy: 'aggressive',
              difficulty: 0.5,
              brain,
            },
          };
        });

        let endReason: 'win' | 'turn-limit' | 'stall' | 'error' = 'error';
        let turns = 0;
        let winner: string | null = null;
        // Date is faked below for AI scheduling; use hrtime for reported wall duration.
        const startedHr = process.hrtime.bigint();
        let prepared: Awaited<ReturnType<typeof prepareLiveGame>> | null = null;

        try {
          prepared = await prepareLiveGame({ gameId, seats, seed: gameSeed, seedAI: true });
          const advanced = await advanceLiveGame(prepared.game, {
            // Cap ticks tightly: softStop + turn/stall guards end the game.
            maxTicks: Math.max(200, MAX_TURNS * 25),
            tickMs: 2_000,
            maxTurns: MAX_TURNS,
            maxStagnantTicks: 40,
            minStagnantWallMs: 15_000,
            // Real wall ms without a turn advance → stall (hrtime must stay unfaked).
            // Only applies once turnNumber > 0 (see advanceLiveGame).
            maxNoTurnAdvanceMs: 60_000,
            // Real wall clock: generous per-tick budget (mulligan/setup ticks can be slow).
            maxWallClockMs: Math.max(180_000, MAX_TURNS * 15_000),
            // Gate soft-stalls included many tick-timeout@60s with stack>0 (storm drain).
            // Keep above a single storm tick; batch kill still bounds the whole process.
            maxTickWallClockMs: 180_000,
            softStop: true,
            label: gameId,
            stopWhen: (game) => Boolean((game.state as any).gameOver),
          });
          turns = advanced.turns;
          endReason = advanced.endReason === 'loop-exhausted' ? 'turn-limit' : advanced.endReason;
          if ((prepared.game.state as any).gameOver) {
            endReason = 'win';
            winner = String((prepared.game.state as any).winner || '') || null;
            if (!winner) {
              const alive = ((prepared.game.state as any).players || []).filter(
                (p: any) => p && !(p.hasLost || p.eliminated || p.conceded),
              );
              winner = alive.length === 1 ? String(alive[0].id) : null;
            }
          }

          const seatBrains: Record<string, string> = {};
          const decks: Record<string, string> = {};
          const seatOrderIds: string[] = [];
          for (const fixture of prepared.joinedFixtures) {
            seatBrains[fixture.actualPlayerId] = fixture.settings.brain || 'v0';
            decks[fixture.actualPlayerId] = fixture.deckId;
            seatOrderIds.push(fixture.actualPlayerId);
          }

          const row = {
            gameId,
            seed: gameSeed,
            decks,
            seatBrains,
            seatOrder: seatOrderIds,
            winner,
            endReason,
            turns,
            ms: Math.round(Number(process.hrtime.bigint() - startedHr) / 1e6),
          };
          results.push(row);
          appendResult(row);
          // eslint-disable-next-line no-console
          console.log(
            `[selfplay] ${gameId} end=${endReason} turns=${turns} ms=${row.ms} (${results.length} this process)`,
          );
        } catch (err) {
          const row = {
            gameId,
            seed: gameSeed,
            decks: Object.fromEntries(decksForSeats.map((d, i) => [`seat${i}`, d.id])),
            seatBrains: {},
            seatOrder: [] as string[],
            winner: null,
            endReason: 'error' as const,
            turns,
            ms: Math.round(Number(process.hrtime.bigint() - startedHr) / 1e6),
            error: String(err),
          };
          results.push(row);
          appendResult(row);
        } finally {
          if (prepared) await cleanupLiveGame(prepared);
        }
      }
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      seedAIRandom(null);
    }

    expect(results.length).toBeGreaterThan(0);
    // Harness itself should not crash every game.
    const harnessErrors = results.filter((r) => r.endReason === 'error');
    expect(
      harnessErrors.length,
      `harness errors: ${harnessErrors.map((r) => r.error).join('; ')}`,
    ).toBeLessThan(results.length);

    // P1-2: when AI_POSITIONS_FILE is set, every game should have at least one
    // feature row per distinct turn observed, with one entry per seat.
    if (POSITIONS_FILE && fs.existsSync(POSITIONS_FILE)) {
      const lines = fs
        .readFileSync(POSITIONS_FILE, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => JSON.parse(l) as {
          v: number;
          gameId: string;
          turn: number;
          features: Record<string, Record<string, number>>;
          eliminated: string[];
        });
      expect(lines.length).toBeGreaterThan(0);
      const byGame = new Map<string, Set<number>>();
      for (const row of lines) {
        expect(row.v).toBe(1);
        expect(Object.keys(row.features).length).toBeGreaterThanOrEqual(2);
        if (!byGame.has(row.gameId)) byGame.set(row.gameId, new Set());
        byGame.get(row.gameId)!.add(row.turn);
      }
      for (const r of results) {
        const gameId = String(r.gameId || '');
        if (!gameId || r.endReason === 'error') continue;
        const turns = byGame.get(gameId);
        expect(turns, `positions missing for ${gameId}`).toBeTruthy();
        expect(turns!.size).toBeGreaterThan(0);
      }
    }
  }, (() => {
    // Four-bot games average ~4–6s/turn; keep vitest timeout above maxWallClockMs.
    const { count: shardCount } = parseShard(SHARD);
    const gamesThisShard = Math.max(1, Math.ceil(GAMES / Math.max(1, shardCount)));
    const wallBudgetMs = Math.max(180_000, MAX_TURNS * 15_000);
    const perGameMs = Math.max(wallBudgetMs + 120_000, MAX_TURNS * 25_000);
    return Math.max(300_000, gamesThisShard * perGameMs + 60_000);
  })());
});


