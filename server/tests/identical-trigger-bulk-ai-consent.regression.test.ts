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

const gameId = 'test_identical_trigger_bulk_ai_consent';

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


const io: any = { to: () => ({ emit: () => true }), emit: () => true, sockets: { sockets: new Map(), adapter: { rooms: new Map() } } };

// Live game (Oct 12): 461 Crusade triggers resolved 1 per ~21s. Each automatic run stopped
// at the AI holder (player_can_respond), which then needed a full AI decision cycle.
// The AI executor now passes its own id: its pass on instance 1 carries over to the rest.
describe('identical trigger run: AI pass carries over to identical instances', () => {
  beforeAll(async () => { await initDb(); });
  afterEach(async () => { await resetGame(); });

  it('stops at a player who could act, unless that player just passed on the first instance', async () => {
    await resetGame();
    const game = setupCrusadeGame();
    createMites(game, 8);
    const run = countIdenticalTopTriggerRun(game.state);
    game.state.priorityClaimed = new Set(['p2']); // p2 "could act"
    expect(await continueCapturedIdenticalTriggerRun(io, game, gameId, { key: run.key, sourceName: run.sourceName })).toBe(0);
    expect(game.state.stack).toHaveLength(8);
    let after = 0;
    const extra = await continueCapturedIdenticalTriggerRun(io, game, gameId,
      { key: run.key, sourceName: run.sourceName }, () => { after += 1; }, 'p2');
    expect(extra).toBe(8);
    expect(after).toBe(1);
    expect(game.state.stack || []).toHaveLength(0);
    expect(isIdenticalTriggerBulkActive(gameId)).toBe(false);
  }, 120000);
});
