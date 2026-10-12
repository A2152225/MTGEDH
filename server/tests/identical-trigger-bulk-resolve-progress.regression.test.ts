import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { createToken } from '../src/state/modules/counters_tokens.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import {
  continueCapturedIdenticalTriggerRun,
  countIdenticalTopTriggerRun,
  isIdenticalTriggerBulkActive,
  runIdenticalTriggerRunAsync,
} from '../src/socket/identicalTriggerBulkResolve.js';
import { createIdenticalTriggerBulkProgress } from '../src/socket/identicalTriggerBulkProgress.js';

const gameId = 'test_identical_trigger_bulk_async';

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try { truncateEventsForUndo(gameId, 0); } catch { /* ignore */ }
  await deleteGame(gameId);
}

const CRUSADE_TEXT = 'Whenever a creature you control enters, put a +1/+1 counter on each creature you control.';

function setupCrusadeGame(): any {
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
  delete game.state.priorityClaimed;
  delete game.state.priorityPassedBy;
  game.state.battlefield = [{
    id: 'crusade', controller: 'p1', owner: 'p1', tapped: false, counters: {},
    card: { id: 'crusade_c', name: "Cathars' Crusade", type_line: 'Enchantment', oracle_text: CRUSADE_TEXT, zone: 'battlefield' },
  }];
  return game;
}

function createMites(game: any, n: number): string[] {
  return createToken(game, 'p1' as any, 'Phyrexian Mite', n, 1, 1, {
    typeLine: 'Token Artifact Creature — Phyrexian Mite',
    abilities: ['Toxic 1', "This token can't block."],
  } as any);
}


type Emit = { room: string; event: string; payload: any };

function fakeIo(log: Emit[]): any {
  const target = (room: string) => ({
    emit: (event: string, payload: any) => { log.push({ room, event, payload }); return true; },
    to: (r2: string) => target(r2),
  });
  return {
    to: target,
    in: target,
    emit: (event: string, payload: any) => { log.push({ room: '*', event, payload }); return true; },
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
  };
}

const progressOf = (log: Emit[]) => log.filter((e) => e.event === 'identicalTriggerBulkProgress').map((e) => e.payload);

describe('identical trigger bulk resolve: async chunks + progress', () => {
  beforeAll(async () => { await initDb(); });
  afterEach(async () => { await resetGame(); });

  it('yields to the event loop between chunks and keeps rules ordering', async () => {
    await resetGame();
    const game = setupCrusadeGame();
    const n = 30;
    createMites(game, n);
    const run = countIdenticalTopTriggerRun(game.state);
    expect(run.count).toBe(n);
    const log: Emit[] = [];

    let ticks = 0;
    const ticker = setInterval(() => { ticks += 1; }, 0);
    let immediates = 0;
    const spin = () => { immediates += 1; if (isIdenticalTriggerBulkActive(gameId)) setImmediate(spin); };
    const promise = runIdenticalTriggerRunAsync(fakeIo(log), game, gameId, {
      key: run.key, consentingPlayerId: 'p1', sourceName: run.sourceName,
    });
    // The first chunk ran synchronously; the run is still active and locked.
    expect(isIdenticalTriggerBulkActive(gameId)).toBe(true);
    setImmediate(spin);
    const result = await promise;
    clearInterval(ticker);

    expect(result).toEqual({ resolved: n, reason: 'complete' });
    expect(isIdenticalTriggerBulkActive(gameId)).toBe(false);
    expect(immediates).toBeGreaterThanOrEqual(Math.floor(n / 5) - 1);
    expect(ticks + immediates).toBeGreaterThan(0);
    expect(game.state.stack || []).toHaveLength(0);
    for (const perm of game.state.battlefield.filter((p: any) => p.isToken)) {
      expect(perm.counters?.['+1/+1']).toBe(n);
    }

    const events = progressOf(log);
    expect(log.every((e) => e.event !== 'identicalTriggerBulkProgress' || e.room === gameId)).toBe(true);
    expect(events[0]).toMatchObject({ phase: 'start', done: 0, total: n, sourceName: "Cathars' Crusade" });
    expect(events[events.length - 1]).toMatchObject({ phase: 'end', done: n, total: n, reason: 'complete' });
    const dones = events.map((e) => e.done);
    expect([...dones].sort((a, b) => a - b)).toEqual(dones);
    expect(new Set(events.map((e) => e.runId)).size).toBe(1);
    // No full state broadcasts inside chunks: suppression is balanced at the end.
    expect(Number(game.state._suppressBroadcastCount || 0)).toBe(0);
  }, 120000);

  it('rejects a second concurrent run and the captured continuation counts the first instance', async () => {
    await resetGame();
    const game = setupCrusadeGame();
    createMites(game, 12);
    const run = countIdenticalTopTriggerRun(game.state);
    const log: Emit[] = [];
    const first = runIdenticalTriggerRunAsync(fakeIo(log), game, gameId, { key: run.key, consentingPlayerId: 'p1', maxCount: 6 });
    const second = await runIdenticalTriggerRunAsync(fakeIo(log), game, gameId, { key: run.key, consentingPlayerId: 'p1' });
    expect(second).toEqual({ resolved: 0, reason: 'busy' });
    expect(await first).toEqual({ resolved: 6, reason: 'complete' });
    expect(game.state.stack).toHaveLength(6);

    // Automatic continuation: p2 has nothing to respond with, p1 is the holder and
    // not consenting, so it stops right away and reports nothing.
    let after = 0;
    game.state.priorityClaimed = new Set(['p1']);
    const extra = await continueCapturedIdenticalTriggerRun(fakeIo(log), game, gameId,
      { key: run.key, sourceName: run.sourceName }, () => { after += 1; });
    expect(extra).toBe(0);
    expect(after).toBe(0);
    const ends = progressOf(log).filter((e) => e.phase === 'end');
    expect(ends[ends.length - 1]).toMatchObject({ reason: 'player_can_respond', done: 1, total: 7 });
  }, 120000);

  it('progress emitter throttles by instance count and time', () => {
    const log: Emit[] = [];
    let t = 1000;
    const p = createIdenticalTriggerBulkProgress(fakeIo(log), 'g', { sourceName: 'X', total: 100, now: () => t });
    p.start(0);
    for (let i = 1; i <= 25; i += 1) p.update(i);
    t += 300;
    p.update(26);
    p.end(26, 'player_can_respond');
    expect(progressOf(log).map((e) => [e.phase, e.done])).toEqual([
      ['start', 0], ['progress', 10], ['progress', 20], ['progress', 26], ['end', 26],
    ]);
    const silent: Emit[] = [];
    const q = createIdenticalTriggerBulkProgress(fakeIo(silent), 'g', { sourceName: 'X', total: 2, silent: true });
    q.start(0); q.update(2); q.end(2, 'complete');
    expect(silent).toHaveLength(0);
  });
});
