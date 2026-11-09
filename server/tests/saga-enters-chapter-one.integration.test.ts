import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/socket/game-actions.js';
import { persistAndResolveTopOfStack } from '../src/socket/util-handlers/appendGameEvent.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

const gameId = 'test_saga_enters_chapter_one';
async function reset() { ResolutionQueueManager.removeQueue(gameId); games.delete(gameId as any); try { await deleteGame(gameId); } catch { /* test-only */ } }
const SAGA = "(As this Saga enters and after your draw step, add a lore counter.)\nI, II — Each opponent creates a 1/1 black Rat Rogue creature token.\nIII — Exile this Saga, then return it to the battlefield transformed under your control.";

describe('Saga cast and resolved', () => {
  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { await reset(); process.env.ORACLE_IR_SPELL_PRIMARY = '1'; process.env.ORACLE_IR_TRIGGER_PRIMARY = '1'; });
  afterEach(reset);

  it('enters with a lore counter and triggers chapter I', () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
    const game: any = ensureGame(gameId);
    const s = game.state;
    s.players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }, { id: 'p2', name: 'P2', spectator: false, life: 40 }];
    s.life = { p1: 40, p2: 40 };
    const z = () => ({ hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 });
    s.zones = { p1: z(), p2: z() };
    s.turnPlayer = 'p1'; s.priority = 'p1'; s.phase = 'precombatMain'; s.step = 'MAIN1';
    s.battlefield = [];
    s.stack = [{ id: 'st1', type: 'spell', controller: 'p1', targets: [], card: { id: 'tribute_c', name: 'Tribute to Horobi', type_line: 'Enchantment — Saga', mana_cost: '{1}{B}', layout: 'transform', oracle_text: SAGA,
      card_faces: [{ name: 'Tribute to Horobi', type_line: 'Enchantment — Saga', mana_cost: '{1}{B}', oracle_text: SAGA }, { name: "Echo of Death's Wail", type_line: 'Enchantment Creature — Spirit', mana_cost: '', oracle_text: 'Haunt', power: '3', toughness: '2' }] } }];
    persistAndResolveTopOfStack(game, gameId);
    const saga = s.battlefield.find((p: any) => p.card?.id === 'tribute_c');
    expect(saga?.counters?.lore).toBe(1);
    const chapter = s.stack.find((x: any) => x.triggerType === 'saga_chapter');
    expect(chapter?.sagaChapter).toBe(1);
  });
});