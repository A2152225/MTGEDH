/**
 * Headless four-bot self-play harness (P0-3).
 *
 * Skipped unless AI_SELFPLAY_GAMES is set.
 * Pool: baked precon catalogue (mtgjson, cardCount 100) — not the 12 text decks.
 *
 * Env:
 *   AI_SELFPLAY_GAMES, AI_SELFPLAY_SEED, AI_SELFPLAY_OUT, AI_SELFPLAY_SHARD (i/n),
 *   AI_SELFPLAY_MAX_TURNS (default 60), AI_SELFPLAY_CHALLENGER (default v0)
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
    vi.useFakeTimers();
    const pool = listSelfPlayPreconPool();
    expect(pool.length).toBeGreaterThanOrEqual(4);

    const { index: shardIndex, count: shardCount } = parseShard(SHARD);
    const results: Array<Record<string, unknown>> = [];

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
          const brain = seatIdx === 0 ? CHALLENGER : 'v0';
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
        const started = Date.now();
        let prepared: Awaited<ReturnType<typeof prepareLiveGame>> | null = null;

        try {
          prepared = await prepareLiveGame({ gameId, seats, seed: gameSeed, seedAI: true });
          const advanced = await advanceLiveGame(prepared.game, {
            maxTicks: Math.max(200, MAX_TURNS * 40),
            tickMs: 2_000,
            maxTurns: MAX_TURNS,
            maxStagnantTicks: 30,
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
            ms: Date.now() - started,
          };
          results.push(row);
          appendResult(row);
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
            ms: Date.now() - started,
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
  }, Math.max(120_000, GAMES * 90_000));
});
