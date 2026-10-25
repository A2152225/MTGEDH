import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
import { isSpellCastingProhibitedByChosenName } from '../src/state/modules/chosen-name-restrictions.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

// Batch 30: end-to-end check that Ixalan's Binding / Ashiok's Erasure's own ETB exile records the linked card,
// so the B29 exiled-card name lock (exiledCardNameCastLock.ts) applies after the trigger resolves.
const gameId = 'b30_exiled_name_lock';
async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}
function perm(id: string, controller: string, name: string, type_line: string, oracle_text = '') {
  return { id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_c', name, type_line, oracle_text, keywords: [] } };
}
const IB = "When Ixalan's Binding enters, exile target nonland permanent an opponent controls until Ixalan's Binding leaves the battlefield.\nYour opponents can't cast spells with the same name as the exiled card.";
const AE = "Flash\nWhen Ashiok's Erasure enters, exile target spell.\nYour opponents can't cast spells with the same name as the exiled card.\nWhen Ashiok's Erasure leaves the battlefield, the exiled card's owner may cast it without paying its mana cost.";
function setup() {
  createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
  const game: any = ensureGame(gameId);
  game.state.players = ['p1', 'p2'].map((id) => ({ id, name: id, spectator: false, life: 40 }));
  game.state.life = { p1: 40, p2: 40 };
  game.state.zones = Object.fromEntries(['p1', 'p2'].map((id) => [id, { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 }]));
  game.state.linkedExiles = [];
  game.state.turnPlayer = 'p1';
  game.state.priority = 'p1';
  return game;
}
function etb(id: string, source: string, name: string, effect: string, targets: string[], card: any) {
  return { id, type: 'triggered_ability', controller: 'p1', source, permanentId: source, sourceName: name, triggerType: 'etb', mandatory: true, description: effect, effect, targets, card };
}

describe('exiled-card name cast lock (integration)', () => {
  beforeAll(async () => { await initDb(); await resetGame(); });
  afterEach(async () => { await resetGame(); });

  it("Ixalan's Binding exiles the target, locks its name for opponents, and unlocks when it leaves", () => {
    const game = setup();
    game.state.battlefield = [perm('ib', 'p1', "Ixalan's Binding", 'Enchantment', IB), perm('ring', 'p2', 'Sol Ring', 'Artifact', '{T}: Add {C}{C}.')];
    const eff = "exile target nonland permanent an opponent controls until Ixalan's Binding leaves the battlefield.";
    game.state.stack = [etb('t1', 'ib', "Ixalan's Binding", eff, ['ring'], game.state.battlefield[0].card)];
    game.resolveTopOfStack();
    expect(game.state.battlefield.map((p: any) => p.id)).toEqual(['ib']);
    expect(game.state.zones.p2.exile.map((c: any) => c.name)).toEqual(['Sol Ring']);
    expect(isSpellCastingProhibitedByChosenName(game.state, 'p2', 'Sol Ring').prohibited).toBe(true);
    expect(isSpellCastingProhibitedByChosenName(game.state, 'p1', 'Sol Ring').prohibited).toBe(false);
    movePermanentToGraveyard(game as any, 'ib', true);
    expect(isSpellCastingProhibitedByChosenName(game.state, 'p2', 'Sol Ring').prohibited).toBe(false);
  });

  it("Ashiok's Erasure exiles the target spell and locks its name for opponents", () => {
    const game = setup();
    game.state.battlefield = [perm('ae', 'p1', "Ashiok's Erasure", 'Enchantment', AE)];
    game.state.stack = [
      { id: 'sp1', type: 'spell', controller: 'p2', owner: 'p2', card: { id: 'bolt_c', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', mana_cost: '{R}' }, targets: [] },
      etb('t2', 'ae', "Ashiok's Erasure", 'exile target spell.', ['sp1'], game.state.battlefield[0].card),
    ];
    game.resolveTopOfStack();
    expect(game.state.stack).toHaveLength(0);
    expect(game.state.zones.p2.exile.map((c: any) => c.name)).toEqual(['Lightning Bolt']);
    expect(isSpellCastingProhibitedByChosenName(game.state, 'p2', 'Lightning Bolt').prohibited).toBe(true);
    expect(isSpellCastingProhibitedByChosenName(game.state, 'p2', 'Shock').prohibited).toBe(false);
  });
});
