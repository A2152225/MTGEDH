import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { createToken } from '../src/state/modules/counters_tokens.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

// Regression: restoring a game where Cathars' Crusade resolved many times on a big board
// (G2: 43k events, 40k per-permanent updateCounters mutations) ran a full SBA pass per
// mutation and took >10 minutes. Consecutive same-source mutations now share one SBA pass.

const gameId = 'test_replay_counter_batch_perf';

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try { truncateEventsForUndo(gameId, 0); } catch { /* ignore */ }
  await deleteGame(gameId);
}

function setupBoard(n: number): { game: any; ids: string[] } {
  createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
  const game: any = ensureGame(gameId);
  if (!game) throw new Error('no game');
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
  game.state.stack = [];
  game.state.battlefield = [];
  const ids = createToken(game, 'p1' as any, 'Soldier', n, 1, 1, { typeLine: 'Token Artifact Creature — Soldier' } as any);
  game.state.stack = [];
  return { game, ids };
}

function counterEvents(ids: string[], sourceIdFor: (resolution: number, i: number) => string, resolutions: number): any[] {
  const events: any[] = [];
  for (let r = 0; r < resolutions; r += 1) {
    ids.forEach((permanentId, i) => events.push({
      type: 'updateCounters', permanentId, deltas: { '+1/+1': 1 }, skipCounterModifications: true,
      oracleIrSourceId: sourceIdFor(r, i), oracleIrSourceName: "Cathars' Crusade", oracleIrReplayMutation: true,
    }));
  }
  return events;
}

function timedReplay(game: any, events: any[]): number {
  const t0 = performance.now();
  game.replay(events);
  return performance.now() - t0;
}

describe('replay: per-permanent counter mutations share one SBA pass', () => {
  beforeAll(async () => { await initDb(); });
  afterEach(async () => { await resetGame(); });

  it('applies every counter, still runs SBA at the end of a batch, and is much faster', async () => {
    const n = 120;
    const resolutions = 3;

    await resetGame();
    const control = setupBoard(n);
    // Unique source per mutation: never batched, one SBA pass per event (old cost).
    const tControl = timedReplay(control.game, counterEvents(control.ids, (r, i) => `src_${r}_${i}`, resolutions));
    const controlCounters = control.game.state.battlefield.map((p: any) => p.counters?.['+1/+1']);

    await resetGame();
    const batched = setupBoard(n);
    const events = counterEvents(batched.ids, (r) => `crusade_trigger_${r}`, resolutions);
    // A damage batch from one source: lethal damage on the first creature mid-batch.
    events.push(
      { type: 'updateCounters', permanentId: batched.ids[0], deltas: { damage: 10 }, skipCounterModifications: true, oracleIrSourceId: 'ptero', oracleIrReplayMutation: true },
      { type: 'updateCounters', permanentId: batched.ids[1], deltas: { damage: 1 }, skipCounterModifications: true, oracleIrSourceId: 'ptero', oracleIrReplayMutation: true },
    );
    const tBatched = timedReplay(batched.game, events);

    expect(controlCounters.every((c: number) => c === resolutions)).toBe(true);
    const bf = batched.game.state.battlefield;
    expect(bf.some((p: any) => p.id === batched.ids[0])).toBe(false); // SBA ran after the batch
    expect(bf.find((p: any) => p.id === batched.ids[1])).toBeTruthy(); // 4/4 with 1 damage survives
    for (const id of batched.ids.slice(1)) {
      expect(bf.find((p: any) => p.id === id)?.counters?.['+1/+1']).toBe(resolutions);
    }

    // eslint-disable-next-line no-console
    console.log(`[perf] replay ${n * resolutions} counter mutations: per-event SBA=${tControl.toFixed(0)}ms batched=${tBatched.toFixed(0)}ms`);
    expect(tBatched).toBeLessThan(tControl / 3);
  }, 240000);
});
