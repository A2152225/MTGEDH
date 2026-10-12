import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser';
import '../src/state/modules/priority.js';

// Issue #56: the quoted token ability ending in `."` swallowed the next sentence, so
// "If X is 5 or more, destroy all other creatures" never became its own step.
const gameId = 'test_white_suns_twilight_x_threshold';
const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;
const TEXT = `You gain X life. Create X 1/1 colorless Phyrexian Mite artifact creature tokens with toxic 1 and "This token can't block." If X is 5 or more, destroy all other creatures. (Players dealt combat damage by a creature with toxic 1 also get a poison counter.)`;
const noopIo = () => ({ to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } }) as any;
const creature = (id: string, controller: string, oracle = '', extra: Record<string, unknown> = {}) => ({
  id, controller, owner: controller, tapped: false, counters: {},
  card: { id: `${id}_card`, name: id, type_line: 'Creature - Bear', power: '2', toughness: '2', oracle_text: oracle }, ...extra,
});

async function reset() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function cast(xValue: number) {
  createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
  const game: any = ensureGame(gameId);
  game.gameId = gameId;
  const state: any = game.state;
  state.players = [{ id: p1, name: 'P1', spectator: false, life: 40 }, { id: p2, name: 'P2', spectator: false, life: 40 }];
  state.life = { [p1]: 40, [p2]: 40 };
  const z = () => ({ hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 });
  state.zones = { [p1]: z(), [p2]: z() };
  state.battlefield = [
    creature('my_bear', p1), creature('my_indestructible', p1, 'Indestructible'),
    creature('their_bear', p2), creature('their_indestructible', p2, 'Indestructible'),
    { ...creature('old_token', p2), isToken: true },
  ];
  state.stack = [{ id: 'wst_stack', type: 'spell', controller: p1, xValue,
    card: { id: 'wst_card', name: "White Sun's Twilight", type_line: 'Sorcery', mana_cost: '{X}{W}{W}', oracle_text: TEXT } }];
  resolveTopOfStack(game);
  return state;
}

describe("White Sun's Twilight X threshold (issue #56)", () => {
  beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(noopIo()); await new Promise((r) => setTimeout(r, 0)); });
  const prior = process.env.ORACLE_IR_SPELL_PRIMARY;
  beforeEach(async () => { process.env.ORACLE_IR_SPELL_PRIMARY = '1'; await reset(); });
  afterEach(async () => {
    if (prior === undefined) delete process.env.ORACLE_IR_SPELL_PRIMARY; else process.env.ORACLE_IR_SPELL_PRIMARY = prior;
    await reset();
  });

  it('parses the X-threshold sentence after a quoted token ability as its own conditional step', () => {
    const steps: any[] = parseOracleTextToIR(TEXT, "White Sun's Twilight").abilities[0].steps as any;
    expect(steps.map((s) => s.kind)).toEqual(['gain_life', 'create_token', 'conditional']);
    expect(steps[2].steps[0].kind).toBe('destroy');
  });

  it('X=50: gains 50, makes 50 Mites, destroys every other non-indestructible creature', () => {
    const state = cast(50);
    const ids = state.battlefield.map((p: any) => p.id);
    expect(state.life[p1]).toBe(90);
    expect(ids).not.toContain('my_bear');
    expect(ids).not.toContain('their_bear');
    expect(ids).not.toContain('old_token');
    expect(ids).toEqual(expect.arrayContaining(['my_indestructible', 'their_indestructible']));
    expect(state.battlefield.filter((p: any) => /mite/i.test(String(p.card?.name || '')))).toHaveLength(50);
  });

  it('X=4 destroys nothing', () => {
    const ids = cast(4).battlefield.map((p: any) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['my_bear', 'their_bear', 'old_token', 'my_indestructible']));
  });
});
