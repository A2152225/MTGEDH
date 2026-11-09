import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initDb } from '../src/db/index.js';
import { initializeAIResolutionHandler } from '../src/socket/resolution.js';
import {
  advanceLiveGame,
  cleanupLiveGame,
  createNoopIo,
  instantiateDeckCards,
  prepareLiveGame,
  readDeckFileNames,
  resolveDeckCards,
  selectCommanders,
  stateSnapshot,
  type DeckSeatSpec,
} from './helpers/liveGameHarness.js';

const DECK_FILES = [
  'precon_json/StopHittingYourself.txt',
  'precon_json/Myrel, Shield of Argive token deck.txt',
  'precon_json/Iroas-Boros.txt',
] as const;

const RUN_SLOW_LIVE_PRECON_FINISH = process.env.RUN_SLOW_LIVE_PRECON_FINISH === '1';
const LIVE_PRECON_REQUIRED_TURNS = Number(process.env.LIVE_PRECON_REQUIRED_TURNS || 10);
const LIVE_PRECON_FAST_TICK_MS = Number(process.env.LIVE_PRECON_FAST_TICK_MS || 5_000);
const LIVE_PRECON_FAST_MAX_TICKS = Number(process.env.LIVE_PRECON_FAST_MAX_TICKS || 300);
const LIVE_PRECON_FAST_MAX_TURNS = Number(process.env.LIVE_PRECON_FAST_MAX_TURNS || 25);
const LIVE_PRECON_FAST_TIMEOUT_MS = RUN_SLOW_LIVE_PRECON_FINISH ? 300_000 : 180_000;

function buildSeatsFromTextFixtures(): DeckSeatSpec[] {
  return DECK_FILES.map((relativePath, index) => {
    const rawCards = readDeckFileNames(relativePath);
    const { resolved, unresolved } = resolveDeckCards(rawCards);
    expect(unresolved, `${relativePath} contains unresolved cards`).toEqual([]);
    expect(resolved.length, `${relativePath} should resolve into a commander deck`).toBeGreaterThan(95);

    const playerId = `ai${index + 1}`;
    const cards = instantiateDeckCards(resolved, playerId);
    const commanders = selectCommanders(cards);
    expect(commanders.length, `${relativePath} should have at least one commander`).toBeGreaterThan(0);

    return {
      deckId: relativePath,
      cardNames: rawCards,
      settings: {
        playerName: path.basename(relativePath, '.txt'),
        aiStrategy: 'aggressive',
        difficulty: 0.5,
        brain: 'v0',
      },
    };
  });
}

describe('live server precon end-to-end', () => {
  beforeAll(async () => {
    await initDb();
    initializeAIResolutionHandler(createNoopIo() as any);
  });

  it('loads the three txt decks into the real server engine and advances multiple live turns without stalling', async () => {
    vi.useFakeTimers();
    const seats = buildSeatsFromTextFixtures();
    const prepared = await prepareLiveGame({
      gameId: 'precon_live_e2e_server_integration',
      seats,
      seedAI: false,
    });

    try {
      const stopDeckCommanders = (prepared.game.state.commandZone || {})[prepared.joinedFixtures[0].actualPlayerId] as any;
      expect(stopDeckCommanders?.commanderIds?.length).toBe(2);
      expect(stopDeckCommanders?.commanderNames).toEqual(
        prepared.joinedFixtures[0].commanders.map((card) => card.name),
      );

      const requiredTurns = LIVE_PRECON_REQUIRED_TURNS;

      await advanceLiveGame(prepared.game, {
        maxTicks: LIVE_PRECON_FAST_MAX_TICKS,
        tickMs: LIVE_PRECON_FAST_TICK_MS,
        maxTurns: LIVE_PRECON_FAST_MAX_TURNS,
        maxStagnantTicks: 6,
        stopWhen: (game) => Number((game.state as any).turnNumber || 0) >= requiredTurns,
        label: 'fast',
      });

      const turnNumber = Number((prepared.game.state as any).turnNumber || 0);
      const gameOver = Boolean((prepared.game.state as any).gameOver);

      expect(gameOver || turnNumber >= requiredTurns).toBe(true);
      expect(String((prepared.game.state as any).phase || '').toLowerCase()).not.toBe('pre_game');

      const zones = (prepared.game.state as any).zones || {};
      const battlefieldCount = Array.isArray((prepared.game.state as any).battlefield)
        ? (prepared.game.state as any).battlefield.length
        : 0;
      const anyLifeChange = ((prepared.game.state as any).players || []).some(
        (player: any) => typeof player?.life === 'number' && player.life !== 40,
      );
      const anyCardsLeftHand = Object.values(zones).some((zone: any) => {
        const handCount = typeof zone?.handCount === 'number'
          ? zone.handCount
          : Array.isArray(zone?.hand) ? zone.hand.length : 0;
        return handCount !== 7;
      });

      expect(battlefieldCount > 0 || anyLifeChange || anyCardsLeftHand).toBe(true);
    } finally {
      await cleanupLiveGame(prepared);
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  }, LIVE_PRECON_FAST_TIMEOUT_MS);

  const slowIt = RUN_SLOW_LIVE_PRECON_FINISH ? it : it.skip;
  slowIt('finishes the three txt decks through the real server engine', async () => {
    vi.useFakeTimers();
    const seats = buildSeatsFromTextFixtures();
    const prepared = await prepareLiveGame({
      gameId: 'precon_live_e2e_server_full_finish',
      seats,
      seedAI: false,
    });

    try {
      await advanceLiveGame(prepared.game, {
        maxTicks: 5000,
        tickMs: 30_000,
        maxTurns: 250,
        maxStagnantTicks: 12,
        maxNoTurnAdvanceMs: 300_000,
        label: 'slow-finish',
      });

      if (!(prepared.game.state as any).gameOver) {
        throw new Error(`Live game did not finish before the slow-test bound: ${JSON.stringify(stateSnapshot(prepared.game))}`);
      }

      expect(String((prepared.game.state as any).winner || '')).not.toBe('');
      const gameOverEvent = prepared.io.emitted.find((entry: any) => entry.event === 'gameOver');
      expect(
        gameOverEvent
        || (prepared.game.state as any).winCondition
        || (prepared.game.state as any).winReason
        || (prepared.game.state as any).gameOver,
      ).toBeTruthy();
    } finally {
      await cleanupLiveGame(prepared);
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  }, 900000);
});
