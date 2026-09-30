import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import '../src/state/modules/priority.js';

const gameId = 'test_martial_coup_x_threshold';
const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;
const MARTIAL_COUP_TEXT = 'Create X 1/1 white Soldier creature tokens. If X is 5 or more, destroy all other creatures.';

function noopIo() {
  return { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } } as any;
}

function creature(id: string, controller: string, oracle = '', extra: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: { id: `${id}_card`, name: id, type_line: 'Creature - Bear', power: '2', toughness: '2', oracle_text: oracle },
    ...extra,
  };
}

async function reset() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function castMartialCoup(xValue: number) {
  createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  (game as any).gameId = gameId;
  const state: any = game.state;
  state.players = [
    { id: p1, name: 'P1', spectator: false, life: 40 },
    { id: p2, name: 'P2', spectator: false, life: 40 },
  ];
  state.life = { [p1]: 40, [p2]: 40 };
  state.zones = {
    [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };
  state.battlefield = [
    creature('my_bear', p1),
    creature('their_bear', p2),
    creature('their_indestructible', p2, 'Indestructible'),
    { ...creature('old_soldier_token', p2), isToken: true },
  ];
  state.stack = [{
    id: 'martial_coup_stack',
    type: 'spell',
    controller: p1,
    xValue,
    card: {
      id: 'martial_coup_card',
      name: 'Martial Coup',
      type_line: 'Sorcery',
      mana_cost: '{X}{W}{W}',
      oracle_text: MARTIAL_COUP_TEXT,
    },
  }];
  resolveTopOfStack(game as any);
  return state;
}

describe('Martial Coup X threshold (integration)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(noopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const priorPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;
  beforeEach(async () => {
    // Production resolves spells through the Oracle IR primary path; the test setup defaults it off.
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    await reset();
  });
  afterEach(async () => {
    if (priorPrimary === undefined) delete process.env.ORACLE_IR_SPELL_PRIMARY;
    else process.env.ORACLE_IR_SPELL_PRIMARY = priorPrimary;
    await reset();
  });

  it('X=4 makes four Soldier tokens and does not destroy any creature', () => {
    const state = castMartialCoup(4);
    const bf: any[] = state.battlefield;
    expect(bf.filter((p) => p.isToken && p.id !== 'old_soldier_token')).toHaveLength(4);
    expect(bf.map((p) => p.id)).toEqual(expect.arrayContaining(['my_bear', 'their_bear', 'their_indestructible', 'old_soldier_token']));
  });

  it('X=5 makes five Soldier tokens, then destroys every OTHER creature except indestructible ones (the new Soldiers survive)', () => {
    const state = castMartialCoup(5);
    const bf: any[] = state.battlefield;
    const ids = bf.map((p) => p.id);
    expect(ids).not.toContain('my_bear');
    expect(ids).not.toContain('their_bear');
    // A Soldier token from an earlier source is "other" and is destroyed; the five new ones are not.
    expect(ids).not.toContain('old_soldier_token');
    expect(ids).toContain('their_indestructible');
    expect(bf.filter((p) => p.isToken && /soldier/i.test(String(p.card?.name || p.name || '')))).toHaveLength(5);
    expect(bf).toHaveLength(6);
  });
});