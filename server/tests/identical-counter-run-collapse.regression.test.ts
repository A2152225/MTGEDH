import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { createToken } from '../src/state/modules/counters_tokens.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { continueIdenticalTriggerRun, countIdenticalTopTriggerRun } from '../src/socket/identicalTriggerBulkResolve.js';
import { isCollapsibleCounterEffect, setIdenticalCounterCollapseEnabled } from '../src/socket/identicalTriggerCollapsedCounterRun.js';

// A run of identical, deterministic counter-placement triggers (Cathars' Crusade x N) resolves
// the first instance normally and the rest as ONE resolveIdenticalCounterRun event, with
// results identical to the per-instance path and to replay. Watchers / replacements fall back.

const gameId = 'test_identical_counter_collapse';
const CRUSADE = 'Whenever a creature you control enters, put a +1/+1 counter on each creature you control.';
const TYPE = 'Token Artifact Creature \u2014 Soldier';

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try { truncateEventsForUndo(gameId, 0); } catch { /* ignore */ }
  await deleteGame(gameId);
}

function perm(id: string, name: string, type: string, oracle: string): any {
  return { id, controller: 'p1', owner: 'p1', tapped: false, counters: {}, card: { id: id + '_c', name, type_line: type, oracle_text: oracle, zone: 'battlefield' } };
}

function setup(extra: any[] = []): any {
  createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
  const game: any = ensureGame(gameId);
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
  game.state.battlefield = [perm('crusade', "Cathars' Crusade", 'Enchantment', CRUSADE), ...extra];
  return game;
}

function boardSig(game: any): string {
  // Token ids are random per game: compare each permanent's name + counters as a sorted multiset.
  return JSON.stringify(game.state.battlefield.map((p: any) => `${p.card?.name}|${JSON.stringify(p.counters || {})}`).sort());
}

async function runCase(n: number, opts: { collapse: boolean; extra?: any[] }) {
  await resetGame();
  setIdenticalCounterCollapseEnabled(opts.collapse);
  const game = setup(opts.extra || []);
  createToken(game, 'p1' as any, 'Soldier', n, 1, 1, { typeLine: TYPE } as any);
  const start = JSON.parse(JSON.stringify(game.state));
  const startEvents = getEvents(gameId).length;
  const run = countIdenticalTopTriggerRun(game.state);
  const t0 = performance.now();
  const resolved = continueIdenticalTriggerRun(null, game, gameId, { key: run.key, consentingPlayerId: 'p1' });
  const ms = performance.now() - t0;
  const events = getEvents(gameId).slice(startEvents);
  return { game, run, resolved, ms, events, start };
}

describe('collapsed identical counter-placement runs', () => {
  beforeAll(async () => { await initDb(); });
  afterEach(async () => { setIdenticalCounterCollapseEnabled(true); await resetGame(); });

  it('only collapses fixed-amount "on each" counter effects', () => {
    expect(isCollapsibleCounterEffect('put a +1/+1 counter on each creature you control.')).toBe(true);
    expect(isCollapsibleCounterEffect('put two +1/+1 counters on each other creature you control.')).toBe(true);
    expect(isCollapsibleCounterEffect('put a +1/+1 counter on each creature you control for each artifact you control.')).toBe(false);
    expect(isCollapsibleCounterEffect('you gain 1 life.')).toBe(false);
    expect(isCollapsibleCounterEffect('put a +1/+1 counter on target creature.')).toBe(false);
  });

  it('matches the per-instance path and replay, with one collapse event', async () => {
    const n = 40;
    const slow = await runCase(n, { collapse: false });
    const slowSig = boardSig(slow.game);
    expect(slow.resolved).toBe(n);

    const fast = await runCase(n, { collapse: true });
    expect(fast.resolved).toBe(n);
    expect(boardSig(fast.game)).toBe(slowSig);
    expect(fast.game.state.stack).toHaveLength(0);
    expect(fast.game.state.priority).toBe('p1');
    for (const p of fast.game.state.battlefield.filter((x: any) => x.isToken)) expect(p.counters?.['+1/+1']).toBe(n);
    const collapse = fast.events.filter((e: any) => e.type === 'resolveIdenticalCounterRun');
    expect(collapse).toHaveLength(1);
    expect(fast.events.filter((e: any) => e.type === 'resolveTopOfStack')).toHaveLength(1);
    expect(fast.events.length).toBeLessThan(slow.events.length / 5);

    const sig = boardSig(fast.game);
    await resetGame();
    createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
    const replay: any = ensureGame(gameId);
    replay.state = Object.assign(replay.state, JSON.parse(JSON.stringify(fast.start)));
    replay.replay(fast.events.map((e: any) => ({ type: e.type, ...(e.payload || {}) })));
    expect(boardSig(replay)).toBe(sig);
    expect(replay.state.stack || []).toHaveLength(0);
  }, 240000);

  it('falls back per instance when a counters-put watcher would trigger', async () => {
    const watcher = perm('watcher', 'Watcher', 'Enchantment', 'Whenever one or more +1/+1 counters are put on a creature you control, you gain 1 life.');
    const res = await runCase(4, { collapse: true, extra: [watcher] });
    expect(res.events.filter((e: any) => e.type === 'resolveIdenticalCounterRun')).toHaveLength(0);
    // First Crusade instance put counters on 4 creatures: 4 watcher triggers now sit on top.
    const watcherItems = (res.game.state.stack || []).filter((s: any) => String(s.sourceName || '') === 'Watcher');
    expect(watcherItems).toHaveLength(4);
    expect(res.resolved).toBe(1);
  }, 120000);

  const SCALES = 'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.';
  const CORPSEJACK = 'If one or more +1/+1 counters would be put on a creature you control, twice that many +1/+1 counters are put on it instead.';

  it('collapses under deterministic modifiers (Hardened Scales) and matches per instance + replay', async () => {
    const scales = () => perm('scales', 'Hardened Scales', 'Enchantment', SCALES);
    const slow = await runCase(6, { collapse: false, extra: [scales()] });
    const res = await runCase(6, { collapse: true, extra: [scales()] });
    expect(res.events.filter((e: any) => e.type === 'resolveIdenticalCounterRun')).toHaveLength(1);
    expect(res.resolved).toBe(6);
    expect(boardSig(res.game)).toBe(boardSig(slow.game));
    for (const p of res.game.state.battlefield.filter((x: any) => x.isToken)) expect(p.counters?.['+1/+1']).toBe(12);

    const sig = boardSig(res.game);
    await resetGame();
    createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
    const replay: any = ensureGame(gameId);
    replay.state = Object.assign(replay.state, JSON.parse(JSON.stringify(res.start)));
    replay.replay(res.events.map((e: any) => ({ type: e.type, ...(e.payload || {}) })));
    expect(boardSig(replay)).toBe(sig); // replay does not re-apply Hardened Scales
  }, 240000);

  it('collapses under stacked Hardened Scales + Corpsejack Menace ((1+1)*2 = 4 per instance)', async () => {
    const mods = () => [perm('scales', 'Hardened Scales', 'Enchantment', SCALES), perm('cj', 'Corpsejack Menace', 'Creature \u2014 Fungus', CORPSEJACK)];
    const slow = await runCase(4, { collapse: false, extra: mods() });
    const res = await runCase(4, { collapse: true, extra: mods() });
    expect(res.events.filter((e: any) => e.type === 'resolveIdenticalCounterRun')).toHaveLength(1);
    expect(boardSig(res.game)).toBe(boardSig(slow.game));
    for (const p of res.game.state.battlefield.filter((x: any) => x.isToken)) expect(p.counters?.['+1/+1']).toBe(16);
  }, 240000);

  it('falls back per instance for an optional modifier', async () => {
    const optional = perm('opt', 'Optional Scales', 'Enchantment', 'If one or more +1/+1 counters would be put on a creature you control, you may have that many plus one +1/+1 counters put on it instead.');
    const res = await runCase(4, { collapse: true, extra: [optional] });
    expect(res.events.filter((e: any) => e.type === 'resolveIdenticalCounterRun')).toHaveLength(0);
  }, 120000);

  it('resolves a 460 x 460 Crusade run with Hardened Scales quickly (+2 each)', async () => {
    const res = await runCase(460, { collapse: true, extra: [perm('scales', 'Hardened Scales', 'Enchantment', SCALES)] });
    expect(res.resolved).toBe(460);
    expect(res.events.filter((e: any) => e.type === 'resolveIdenticalCounterRun')).toHaveLength(1);
    for (const p of res.game.state.battlefield.filter((x: any) => x.isToken)) expect(p.counters?.['+1/+1']).toBe(920);
    // eslint-disable-next-line no-console
    console.log(`[perf] collapsed 460x460 Crusade + Hardened Scales: ${res.ms.toFixed(0)}ms`);
    expect(res.ms).toBeLessThan(15000);
  }, 240000);

  it('resolves a 460 x 460 Crusade run quickly', async () => {
    const res = await runCase(460, { collapse: true });
    expect(res.resolved).toBe(460);
    for (const p of res.game.state.battlefield.filter((x: any) => x.isToken)) expect(p.counters?.['+1/+1']).toBe(460);
    // eslint-disable-next-line no-console
    console.log(`[perf] collapsed 460x460 Crusade run: ${res.ms.toFixed(0)}ms, ${res.events.length} events`);
    expect(res.ms).toBeLessThan(15000);
  }, 240000);
});
