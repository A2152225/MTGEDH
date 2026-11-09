import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/socket/game-actions.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { removeLeavingPlayerGameObjects } from '../src/state/modules/playerLeavingGame.js';

const gameId = 'test_player_leaves_ltb_triggers';
async function reset() { ResolutionQueueManager.removeQueue(gameId); games.delete(gameId as any); try { await deleteGame(gameId); } catch { /* test-only */ } }

describe('player leaving the game (CR 603.6c / 800.4a)', () => {
  beforeAll(async () => { await initDb(); });
  beforeEach(reset);
  afterEach(reset);

  it("triggers other players' leaves-the-battlefield abilities, but not the leaver's own", () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
    const game: any = ensureGame(gameId);
    const s = game.state;
    s.players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }, { id: 'p2', name: 'P2', spectator: false, life: 40 }, { id: 'p3', name: 'P3', spectator: false, life: 40 }];
    s.life = { p1: 40, p2: 40, p3: 40 };
    const z = () => ({ hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 });
    s.zones = { p1: z(), p2: z(), p3: z() };
    s.turnPlayer = 'p1'; s.priority = 'p1'; s.phase = 'precombatMain'; s.step = 'MAIN1'; s.stack = [];
    const watcher = (id: string, owner: string) => ({ id, controller: owner, owner, tapped: false, counters: {},
      card: { id: `${id}_c`, name: `Watcher ${id}`, type_line: 'Creature — Spirit', power: '1', toughness: '1',
        oracle_text: 'Whenever another creature leaves the battlefield, you gain 1 life.' } });
    s.battlefield = [
      watcher('w1', 'p1'),
      watcher('w2', 'p2'),
      { id: 'b2', controller: 'p2', owner: 'p2', tapped: false, counters: {}, card: { id: 'b2_c', name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2', oracle_text: '' } },
    ];
    removeLeavingPlayerGameObjects(s, 'p2', { gameId, ctx: game });
    expect(s.battlefield.map((p: any) => p.id)).toEqual(['w1']);
    const ltb = (s.stack || []).filter((x: any) => x.type === 'triggered_ability');
    expect(ltb.length).toBe(2);
    expect(ltb.every((x: any) => x.controller === 'p1' && x.permanentId === 'w1')).toBe(true);
  });
});