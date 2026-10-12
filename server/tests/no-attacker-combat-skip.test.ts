import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { advanceStepPersistingEvent } from '../src/socket/step-advance.js';
import { createInitialGameState } from '../src/state/index.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { getOpponentSpellCastTriggers } from '../src/state/modules/triggers/spell-cast.js';

// G1.txt (game_mv4dicck, Oct 11): with no attackers declared, every turn still walked
// DECLARE_BLOCKERS and DAMAGE, handing priority to each AI seat with an instant-speed option in
// each extra step, so priority visibly ping-ponged between AIs in an empty combat.
const gameId = 'test_no_attacker_combat_skip';
const ioStub: any = { to: () => ({ emit() {} }), emit() {}, in: () => ({ emit() {} }), sockets: { sockets: new Map() } };

function creature(id: string, controller: string, extra: any = {}) {
  return {
    id, controller, owner: controller, tapped: false, counters: {}, ...extra,
    card: { id: `${id}_c`, name: 'Grizzly Bears', type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' },
  };
}

function seedCombat(game: any, attacking: boolean) {
  const ids = ['p1', 'p2'];
  game.state.players = ids.map((id) => ({ id, name: id, spectator: false, life: 40 }));
  game.state.life = { p1: 40, p2: 40 };
  game.state.zones = Object.fromEntries(ids.map((id) => [id, { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 }]));
  game.state.turnPlayer = 'p1';
  game.state.priority = 'p1';
  game.state.phase = 'combat';
  game.state.step = 'DECLARE_ATTACKERS';
  game.state.stack = [];
  game.state.attackersDeclaredBy = ['p1'];
  game.state.battlefield = [
    creature('bear1', 'p1', attacking ? { attacking: 'p2' } : {}),
    creature('bear2', 'p2'),
  ];
}

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try { truncateEventsForUndo(gameId, 0); } catch {}
  await deleteGame(gameId);
}

describe('rule 508.8: no attackers skips declare blockers and combat damage', () => {
  beforeAll(async () => { await initDb(); await resetGame(); });
  afterAll(async () => { await resetGame(); });

  it('live advance from DECLARE_ATTACKERS with no attackers goes straight to END_COMBAT', () => {
    const game: any = createInitialGameState('t508_live' as any);
    seedCombat(game, false);
    game.nextStep();
    expect(game.state.phase).toBe('combat');
    expect(game.state.step).toBe('END_COMBAT');
    game.nextStep();
    expect(game.state.step).toBe('MAIN2');
  });

  it('with an attacker, DECLARE_BLOCKERS still follows DECLARE_ATTACKERS', () => {
    const game: any = createInitialGameState('t508_attack' as any);
    seedCombat(game, true);
    game.nextStep();
    expect(game.state.step).toBe('DECLARE_BLOCKERS');
  });

  it('persisted nextStep is stamped so replay reproduces the skip; unstamped legacy events do not skip', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
    const game: any = ensureGame(gameId);
    seedCombat(game, false);
    expect(advanceStepPersistingEvent(ioStub, game, gameId, { reason: 'test' })).toBe(true);
    expect(game.state.step).toBe('END_COMBAT');
    const last = (getEvents(gameId) as any[]).filter((e) => e.type === 'nextStep').pop();
    expect(last?.payload?.skippedNoAttackerCombat).toBe(true);

    const stamped: any = createInitialGameState('t508_replay_stamped' as any);
    seedCombat(stamped, false);
    stamped.replay([{ type: 'nextStep', skippedNoAttackerCombat: true }]);
    expect(stamped.state.step).toBe('END_COMBAT');

    const legacy: any = createInitialGameState('t508_replay_legacy' as any);
    seedCombat(legacy, false);
    legacy.replay([{ type: 'nextStep' }]);
    expect(legacy.state.step).toBe('DECLARE_BLOCKERS');
  });

  it('opponent spell-cast trigger scan no longer throws (castFromZone ReferenceError seen in the same log)', () => {
    const battlefield = [{
      id: 'rhystic', controller: 'p2', owner: 'p2',
      card: { id: 'rs_c', name: 'Rhystic Study', type_line: 'Enchantment', oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.' },
    }];
    const spell = { id: 'sp', name: 'Grizzly Bears', type_line: 'Creature - Bear' };
    let triggers: any[] = [];
    expect(() => { triggers = getOpponentSpellCastTriggers(battlefield, 'p1', spell, ['p1', 'p2'], false, 'hand', 1); }).not.toThrow();
    expect(triggers.length).toBeGreaterThan(0);
  });
});
