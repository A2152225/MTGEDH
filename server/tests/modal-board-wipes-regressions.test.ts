import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

// Modal board wipes from game_muxjp9tq (G2.txt: Cleansing Nova #30, Austere Command #31)
// and the restricted "creature with power N or greater" target leftover.
const gameId = 'test_modal_board_wipes';

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try { truncateEventsForUndo(gameId, 0); } catch {}
  await deleteGame(gameId);
}

function perm(id: string, controller: string, name: string, type_line: string, extra: any = {}) {
  const { oracle_text = '', cmc = 0, mana_cost = '', power, toughness, keywords = [], ...rest } = extra;
  return {
    id, controller, owner: controller, tapped: false, counters: {}, ...rest,
    card: { id: `${id}_c`, name, type_line, oracle_text, cmc, mana_cost, power, toughness, keywords },
  };
}

function setup() {
  createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
  const game: any = ensureGame(gameId);
  const ids = ['p1', 'p2'];
  game.state.players = ids.map((id) => ({ id, name: id, spectator: false, life: 40 }));
  game.state.life = { p1: 40, p2: 40 };
  game.state.zones = Object.fromEntries(ids.map((id) => [id, { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 }]));
  game.state.turnPlayer = 'p1';
  game.state.priority = 'p1';
  game.state.battlefield = [
    perm('bear', 'p1', 'Grizzly Bears', 'Creature - Bear', { cmc: 2, mana_cost: '{1}{G}', power: '2', toughness: '2' }),
    perm('ogre', 'p2', 'Gray Ogre', 'Creature - Ogre', { cmc: 3, mana_cost: '{2}{R}', power: '2', toughness: '2' }),
    perm('giant', 'p2', 'Hill Giant', 'Creature - Giant', { cmc: 4, mana_cost: '{3}{R}', power: '4', toughness: '4' }),
    perm('wurm', 'p2', 'Craw Wurm', 'Creature - Wurm', { cmc: 6, mana_cost: '{4}{G}{G}', power: '6', toughness: '4' }),
    perm('ring', 'p2', 'Sol Ring', 'Artifact', { cmc: 1, mana_cost: '{1}', oracle_text: '{T}: Add {C}{C}.' }),
    perm('prison', 'p2', 'Ghostly Prison', 'Enchantment', { cmc: 3, mana_cost: '{2}{W}', oracle_text: "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you." }),
    perm('plains', 'p1', 'Plains', 'Basic Land - Plains', { oracle_text: '({T}: Add {W}.)' }),
  ];
  game.state.stack = [];
  return game;
}

function castModal(game: any, name: string, oracle: string, modes: string[]) {
  game.state.stack = [{
    id: `sp_${name}`, type: 'spell', controller: 'p1', targets: [], selectedModes: modes,
    card: { id: `${name}_c`, name, type_line: 'Sorcery', oracle_text: oracle, mana_cost: '{3}{W}{W}', selectedModes: modes },
  }];
  game.resolveTopOfStack();
  return game.state.battlefield.map((p: any) => p.id);
}

const NOVA = 'Choose one \u2014\n\u2022 Destroy all creatures.\n\u2022 Destroy all artifacts and enchantments.';
const AUSTERE = 'Choose two \u2014\n\u2022 Destroy all artifacts.\n\u2022 Destroy all enchantments.\n\u2022 Destroy all creatures with mana value 3 or less.\n\u2022 Destroy all creatures with mana value 4 or greater.';

describe('modal board wipes (G2.txt)', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;
  beforeAll(async () => { await initDb(); await resetGame(); });
  beforeEach(() => { process.env.ORACLE_IR_SPELL_PRIMARY = '1'; });
  afterAll(() => {
    if (previousPrimary === undefined) delete process.env.ORACLE_IR_SPELL_PRIMARY;
    else process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
  });
  afterEach(async () => { await resetGame(); });

  it('Cleansing Nova mode 1 destroys every creature, respects granted indestructible, and keeps noncreatures', () => {
    const game = setup();
    game.state.battlefield.push(
      perm('seph', 'p1', "Sephara, Sky's Blade", 'Legendary Creature - Angel', { cmc: 7, mana_cost: '{4}{W}{W}{W}', power: '4', toughness: '3', keywords: ['Flying', 'Lifelink'], oracle_text: 'Flying, lifelink\nOther creatures you control with flying have indestructible.' }),
      perm('serra', 'p1', 'Serra Angel', 'Creature - Angel', { cmc: 5, mana_cost: '{3}{W}{W}', power: '4', toughness: '4', keywords: ['Flying', 'Vigilance'], oracle_text: 'Flying, vigilance' }),
    );
    // A destroyed commander (command-zone choice) must not stop the rest of the wipe (G2.txt #30).
    game.state.battlefield.push(
      perm('cmdr', 'p2', 'Omnath, Locus of Mana', 'Legendary Creature - Elemental', { cmc: 3, mana_cost: '{2}{G}', power: '1', toughness: '1', isCommander: true }),
    );
    game.commandZone = { p2: { commanderIds: ['cmdr_c'], commanderCards: [] } };
    game.state.commandZone = game.commandZone;
    const left = castModal(game, 'Cleansing Nova', NOVA, ['Mode 1']);
    expect(left).toEqual(expect.arrayContaining(['serra', 'ring', 'prison', 'plains']));
    for (const id of ['bear', 'ogre', 'giant', 'wurm', 'seph', 'cmdr']) expect(left).not.toContain(id);
  });

  it('Cleansing Nova mode 2 destroys artifacts and enchantments only', () => {
    const game = setup();
    const left = castModal(game, 'Cleansing Nova', NOVA, ['Mode 2']);
    expect(left).toEqual(expect.arrayContaining(['bear', 'ogre', 'giant', 'wurm', 'plains']));
    expect(left).not.toContain('ring');
    expect(left).not.toContain('prison');
  });

  it('Austere Command artifacts + creatures with mana value 3 or less', () => {
    const game = setup();
    const left = castModal(game, 'Austere Command', AUSTERE, ['Mode 1', 'Mode 3']);
    expect(left).toEqual(expect.arrayContaining(['giant', 'wurm', 'prison', 'plains']));
    for (const id of ['bear', 'ogre', 'ring']) expect(left).not.toContain(id);
  });

  it('Austere Command enchantments + creatures with mana value 4 or greater', () => {
    const game = setup();
    const left = castModal(game, 'Austere Command', AUSTERE, ['Mode 2', 'Mode 4']);
    expect(left).toEqual(expect.arrayContaining(['bear', 'ogre', 'ring', 'plains']));
    for (const id of ['giant', 'wurm', 'prison']) expect(left).not.toContain(id);
  });

  it('"Exile target creature with power 4 or greater" never falls back to an unchosen creature', () => {
    const game = setup();
    game.state.stack = [{
      id: 'sp_exile', type: 'spell', controller: 'p1', targets: ['ring'],
      card: { id: 'ex_c', name: 'Test Exile', type_line: 'Instant', oracle_text: 'Exile target creature with power 4 or greater.', mana_cost: '{1}{W}' },
    }];
    game.resolveTopOfStack();
    const left = game.state.battlefield.map((p: any) => p.id);
    for (const id of ['bear', 'ogre', 'giant', 'wurm', 'ring']) expect(left).toContain(id);
  });

  it('"Exile target creature with power 4 or greater" exiles the chosen legal creature', () => {
    const game = setup();
    game.state.stack = [{
      id: 'sp_exile2', type: 'spell', controller: 'p1', targets: ['wurm'],
      card: { id: 'ex2_c', name: 'Test Exile', type_line: 'Instant', oracle_text: 'Exile target creature with power 4 or greater.', mana_cost: '{1}{W}' },
    }];
    game.resolveTopOfStack();
    const left = game.state.battlefield.map((p: any) => p.id);
    expect(left).not.toContain('wurm');
    for (const id of ['bear', 'ogre', 'giant']) expect(left).toContain(id);
  });
});
