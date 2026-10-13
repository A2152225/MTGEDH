import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { applyUpdateCountersBulk, createToken, updateCounters } from '../src/state/modules/counters_tokens.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { continueIdenticalTriggerRun, countIdenticalTopTriggerRun } from '../src/socket/identicalTriggerBulkResolve.js';

// Regression: the IR counter commit already applied Hardened Scales / Doubling Season, then
// the server's post-IR counter sync applied them again on the observed delta, so one
// Cathars' Crusade instance put 3 counters (not 2) on each creature under Hardened Scales.

const gameId = 'test_counter_modifier_once';
const CRUSADE = 'Whenever a creature you control enters, put a +1/+1 counter on each creature you control.';
const SCALES = 'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.';
const DOUBLING = 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.\nIf an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.';
const CORPSEJACK = 'If one or more +1/+1 counters would be put on a creature you control, twice that many +1/+1 counters are put on it instead.';

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try { truncateEventsForUndo(gameId, 0); } catch { /* ignore */ }
  await deleteGame(gameId);
}

function perm(id: string, name: string, type: string, oracle: string): any {
  return { id, controller: 'p1', owner: 'p1', tapped: false, counters: {}, card: { id: id + '_c', name, type_line: type, oracle_text: oracle, zone: 'battlefield' } };
}

function setup(extra: any[]): any {
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
  game.state.battlefield = extra;
  return game;
}

async function crusadeRun(modifiers: any[], tokens: number): Promise<number[]> {
  await resetGame();
  const game = setup([perm('crusade', "Cathars' Crusade", 'Enchantment', CRUSADE), ...modifiers]);
  // Bypass token doubling: create the tokens directly, then resolve every Crusade trigger.
  createToken(game, 'p1' as any, 'Soldier', tokens, 1, 1, { typeLine: 'Token Artifact Creature \u2014 Soldier' } as any);
  const run = countIdenticalTopTriggerRun(game.state);
  continueIdenticalTriggerRun(null, game, gameId, { key: run.key, consentingPlayerId: 'p1' });
  return game.state.battlefield.filter((p: any) => p.isToken).map((p: any) => Number(p.counters?.['+1/+1'] || 0));
}

describe('counter modifiers apply exactly once', () => {
  beforeAll(async () => { await initDb(); });
  afterEach(async () => { await resetGame(); });

  it('Hardened Scales: each Crusade instance adds 2 (4 instances -> 8)', async () => {
    const counts = await crusadeRun([perm('scales', 'Hardened Scales', 'Enchantment', SCALES)], 4);
    expect(counts).toEqual([8, 8, 8, 8]);
  }, 120000);

  it('Corpsejack Menace: each instance adds 2', async () => {
    const counts = await crusadeRun([perm('cj', 'Corpsejack Menace', 'Creature \u2014 Fungus', CORPSEJACK)], 3);
    expect(counts).toEqual([6, 6, 6]);
  }, 120000);

  it('Hardened Scales + Corpsejack Menace stack once each: (1+1)*2 = 4 per instance', async () => {
    const counts = await crusadeRun([
      perm('scales', 'Hardened Scales', 'Enchantment', SCALES),
      perm('cj', 'Corpsejack Menace', 'Creature \u2014 Fungus', CORPSEJACK),
    ], 3);
    expect(counts).toEqual([12, 12, 12]);
  }, 120000);

  it('direct single-target updateCounters applies Hardened Scales once', async () => {
    await resetGame();
    const game = setup([perm('scales', 'Hardened Scales', 'Enchantment', SCALES), perm('bear', 'Bear', 'Creature \u2014 Bear', '')]);
    updateCounters(game, 'bear', { '+1/+1': 1 });
    expect(game.state.battlefield.find((p: any) => p.id === 'bear').counters['+1/+1']).toBe(2);
  });

  it('applyUpdateCountersBulk applies Doubling Season once per permanent; persisted bulk replays verbatim', async () => {
    await resetGame();
    const game = setup([
      perm('ds', 'Doubling Season', 'Enchantment', DOUBLING),
      perm('a', 'Bear A', 'Creature \u2014 Bear', ''),
      perm('b', 'Bear B', 'Creature \u2014 Bear', ''),
    ]);
    applyUpdateCountersBulk(game, [{ permanentId: 'a', deltas: { '+1/+1': 1 } }, { permanentId: 'b', deltas: { '+1/+1': 2 } }]);
    const bf = game.state.battlefield;
    expect(bf.find((p: any) => p.id === 'a').counters['+1/+1']).toBe(2);
    expect(bf.find((p: any) => p.id === 'b').counters['+1/+1']).toBe(4);
    applyUpdateCountersBulk(game, [{ permanentId: 'a', deltas: { '+1/+1': 2 } }], { skipCounterModifications: true, skipEventPersistence: true });
    expect(bf.find((p: any) => p.id === 'a').counters['+1/+1']).toBe(4);
  });
});
