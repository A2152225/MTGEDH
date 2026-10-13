import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { createToken } from '../src/state/modules/counters_tokens.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { continueIdenticalTriggerRun, countIdenticalTopTriggerRun } from '../src/socket/identicalTriggerBulkResolve.js';

// One "put a counter on each creature" resolution (Cathars' Crusade) persists ONE
// updateCountersBulk event instead of one updateCounters per creature, and replaying the
// persisted log reproduces the live board exactly.

const gameId = 'test_counter_batch_persist';
const CRUSADE_TEXT = 'Whenever a creature you control enters, put a +1/+1 counter on each creature you control.';
const BOARD = 460;

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try { truncateEventsForUndo(gameId, 0); } catch { /* ignore */ }
  await deleteGame(gameId);
}

function baseState(game: any): void {
  game.state.players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  game.state.life = { p1: 40, p2: 40 };
  game.state.zones = {
    p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
  };
  game.state.turnPlayer = 'p1';
  game.state.priority = 'p1';
  game.state.phase = 'main1';
  game.state.step = 'MAIN1';
  delete game.state.priorityClaimed;
  delete game.state.priorityPassedBy;
}

function crusadePermanent(): any {
  return {
    id: 'crusade', controller: 'p1', owner: 'p1', tapped: false, counters: {},
    card: { id: 'crusade_c', name: "Cathars' Crusade", type_line: 'Enchantment', oracle_text: CRUSADE_TEXT, zone: 'battlefield' },
  };
}

function boardSignature(game: any): string {
  return JSON.stringify((game.state.battlefield || [])
    .map((p: any) => [p.id, p.counters || {}, Number(p.damageMarked || p.damage || 0)])
    .sort((a: any, b: any) => String(a[0]).localeCompare(String(b[0]))));
}

describe('batched counter persistence (one event per resolution)', () => {
  beforeAll(async () => { await initDb(); });
  afterEach(async () => { await resetGame(); });

  it('persists one batch per Crusade resolution at ~460 creatures, fast, and replays identically', async () => {
    await resetGame();
    createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
    const game: any = ensureGame(gameId);
    baseState(game);
    game.state.stack = [];
    game.state.battlefield = [];
    createToken(game, 'p1' as any, 'Soldier', BOARD, 1, 1, { typeLine: 'Token Artifact Creature \u2014 Soldier' } as any);
    game.state.battlefield.push(crusadePermanent());
    game.state.stack = [];
    const startState = JSON.parse(JSON.stringify(game.state));
    const startEvents = getEvents(gameId).length;

    createToken(game, 'p1' as any, 'Soldier', 3, 1, 1, { typeLine: 'Token Artifact Creature \u2014 Soldier' } as any);
    const run = countIdenticalTopTriggerRun(game.state);
    expect(run.count).toBe(3);

    const times: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const t0 = performance.now();
      expect(continueIdenticalTriggerRun(null, game, gameId, { key: run.key, consentingPlayerId: 'p1', maxCount: 1 })).toBe(1);
      times.push(performance.now() - t0);
    }
    const tokens = game.state.battlefield.filter((p: any) => p.isToken);
    expect(tokens.every((p: any) => p.counters?.['+1/+1'] === 3)).toBe(true);

    const events = getEvents(gameId).slice(startEvents);
    const perPermanent = events.filter((e: any) => e.type === 'updateCounters').length;
    const bulk = events.filter((e: any) => e.type === 'updateCountersBulk');
    // eslint-disable-next-line no-console
    console.log(`[perf] crusade resolution at ${BOARD + 3} creatures: ${times.map((t) => t.toFixed(0)).join('/')}ms; events: updateCounters=${perPermanent} bulk=${bulk.length} total=${events.length}`);
    expect(perPermanent).toBe(0);
    // Was ~0.8s live (per-creature events + O(board^2) haste / trigger scans); warm cost is now ~0.1s.
    expect(Math.min(...times.slice(1))).toBeLessThan(400);
    expect(bulk).toHaveLength(3);
    expect((bulk[0] as any).payload?.updates?.length ?? (bulk[0] as any).updates?.length).toBe(BOARD + 3);
    const liveSig = boardSignature(game);

    // Replay the persisted tail onto the starting state in a fresh game.
    await resetGame();
    createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
    const replayGame: any = ensureGame(gameId);
    replayGame.state = Object.assign(replayGame.state, JSON.parse(JSON.stringify(startState)));
    const t0 = performance.now();
    replayGame.replay(events.map((e: any) => ({ type: e.type, ...(e.payload || {}) })));
    const tReplay = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[perf] replay of ${events.length} events: ${tReplay.toFixed(0)}ms`);
    expect(boardSignature(replayGame)).toBe(liveSig);
    expect(replayGame.state.stack || []).toHaveLength(0);
  }, 240000);
});
