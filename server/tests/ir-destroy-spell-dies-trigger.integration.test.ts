import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/socket/game-actions.js';
import { persistAndResolveTopOfStack } from '../src/socket/util-handlers/appendGameEvent.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

const gameId = 'test_ir_destroy_spell_dies_trigger';
async function reset() { ResolutionQueueManager.removeQueue(gameId); games.delete(gameId as any); try { await deleteGame(gameId); } catch { /* test-only */ } }

describe('IR destroy spell fires the destroyed creature\'s dies trigger', () => {
  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { await reset(); process.env.ORACLE_IR_SPELL_PRIMARY = '1'; process.env.ORACLE_IR_TRIGGER_PRIMARY = '1'; });
  afterEach(reset);

  it('Damn on Veteran Explorer', () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
    const game: any = ensureGame(gameId);
    const s = game.state;
    s.players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }, { id: 'p2', name: 'P2', spectator: false, life: 40 }];
    s.life = { p1: 40, p2: 40 };
    const z = () => ({ hand: [], graveyard: [], exile: [], library: [{ id: 'f1', name: 'Forest', type_line: 'Basic Land — Forest' }], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 1 });
    s.zones = { p1: z(), p2: z() };
    s.turnPlayer = 'p1'; s.priority = 'p1'; s.phase = 'precombatMain'; s.step = 'MAIN1';
    s.battlefield = [{ id: 've', controller: 'p2', owner: 'p2', counters: {}, card: { id: 've_c', name: 'Veteran Explorer', type_line: 'Creature — Human Soldier Scout', oracle_text: 'When this creature dies, each player may search their library for up to two basic land cards, put them onto the battlefield, then shuffle.', power: '1', toughness: '1' } }];
    s.stack = [{ id: 'st1', type: 'spell', controller: 'p1', targets: ['ve'], card: { id: 'damn', name: 'Damn', type_line: 'Sorcery', mana_cost: '{B}{B}', oracle_text: "Destroy target creature. A creature destroyed this way can't be regenerated.\nOverload {2}{W}{W} (You may cast this spell for its overload cost. If you do, change \"target\" to \"each.\")" } }];
    persistAndResolveTopOfStack(game, gameId);
    const queued = [...s.stack.map((x: any) => x.sourceName), ...ResolutionQueueManager.getQueue(gameId).steps.map((x: any) => x.sourceName)];
    expect(s.zones.p2.graveyard.map((c: any) => c.name)).toContain('Veteran Explorer');
    expect(queued.filter((n: string) => n === 'Veteran Explorer')).toHaveLength(1);
    persistAndResolveTopOfStack(game, gameId);
    const steps = ResolutionQueueManager.getQueue(gameId).steps;
    expect(steps.filter((x: any) => x.type === 'library_search').map((x: any) => x.playerId).sort()).toEqual(['p1', 'p2']);
  });
});