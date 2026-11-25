import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { extractModalModesForSpellCast } from '../src/utils/oraclePromptContext.js';

// Resolution regressions from the cast lane: Blizzard Brawl's fight was folded into its
// snow conditional, and Crash and Burn mode 2 must only damage its chosen target.
const gameId = 'test_oracle_ir_modal_fight_resolution';

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try { truncateEventsForUndo(gameId, 0); } catch {}
  await deleteGame(gameId);
}

function perm(id: string, controller: string, name: string, type_line: string, extra: any = {}) {
  const { oracle_text = '', cmc = 0, mana_cost = '', power, toughness, ...rest } = extra;
  return {
    id, controller, owner: controller, tapped: false, counters: {}, damage: 0, ...rest,
    ...(power !== undefined ? { basePower: Number(power), baseToughness: Number(toughness) } : {}),
    card: { id: `${id}_c`, name, type_line, oracle_text, cmc, mana_cost, power, toughness, keywords: [] },
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
    perm('wurm', 'p1', 'Craw Wurm', 'Creature - Wurm', { cmc: 6, mana_cost: '{4}{G}{G}', power: '6', toughness: '4' }),
    perm('ogre', 'p2', 'Gray Ogre', 'Creature - Ogre', { cmc: 3, mana_cost: '{2}{R}', power: '2', toughness: '2' }),
    perm('giant', 'p2', 'Hill Giant', 'Creature - Giant', { cmc: 4, mana_cost: '{3}{R}', power: '3', toughness: '3' }),
    perm('ring', 'p2', 'Sol Ring', 'Artifact', { cmc: 1, mana_cost: '{1}', oracle_text: '{T}: Add {C}{C}.' }),
    perm('cart', 'p2', 'Smuggler\'s Copter', 'Artifact - Vehicle', { cmc: 2, mana_cost: '{2}', power: '3', toughness: '3' }),
    perm('plains', 'p1', 'Plains', 'Basic Land - Plains'),
    perm('forest', 'p2', 'Forest', 'Basic Land - Forest'),
  ];
  game.state.stack = [];
  return game;
}

function cast(game: any, name: string, oracle: string, targets: string[], modes?: string[]) {
  game.state.stack = [{
    id: `sp_${name}`, type: 'spell', controller: 'p1', targets,
    ...(modes ? { selectedModes: modes } : {}),
    card: { id: `${name}_c`, name, type_line: 'Instant', oracle_text: oracle, mana_cost: '{R}{G}', ...(modes ? { selectedModes: modes } : {}) },
  }];
  game.resolveTopOfStack();
  return game.state.battlefield.map((p: any) => p.id);
}

const CRASH = 'Choose one \u2014\n\u2022 Destroy target Vehicle.\n\u2022 Crash and Burn deals 6 damage to target creature or planeswalker.';
const BRAWL = "Choose target creature you control and target creature you don't control. If you control three or more snow permanents, the creature you control gets +1/+0 and gains indestructible until end of turn. Then those creatures fight each other.";

describe('oracle IR modal and fight resolution', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;
  beforeAll(async () => { await initDb(); await resetGame(); });
  beforeEach(() => { process.env.ORACLE_IR_SPELL_PRIMARY = '1'; });
  afterAll(() => {
    if (previousPrimary === undefined) delete process.env.ORACLE_IR_SPELL_PRIMARY;
    else process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
  });
  afterEach(async () => { await resetGame(); });

  for (const modeId of ['mode_2', 'Mode 2']) {
    it(`Crash and Burn ${modeId} damages only the chosen creature`, () => {
      const game = setup();
      const left = cast(game, 'Crash and Burn', CRASH, ['giant'], [modeId]);
      expect(left).not.toContain('giant');
      for (const id of ['bear', 'wurm', 'ogre', 'ring', 'cart', 'plains', 'forest']) expect(left).toContain(id);
    });
  }

  it('Crash and Burn mode 1 destroys only the chosen Vehicle', () => {
    const game = setup();
    const left = cast(game, 'Crash and Burn', CRASH, ['cart'], ['mode_1']);
    expect(left).not.toContain('cart');
    for (const id of ['bear', 'wurm', 'ogre', 'giant', 'ring', 'plains', 'forest']) expect(left).toContain(id);
  });

  it('Crash and Burn mode 1 with a non-Vehicle target destroys nothing (no retarget)', () => {
    const game = setup();
    const left = cast(game, 'Crash and Burn', CRASH, ['giant'], ['mode_1']);
    for (const id of ['bear', 'wurm', 'ogre', 'giant', 'ring', 'cart', 'plains', 'forest']) expect(left).toContain(id);
  });

  it('Crash and Burn mode labels keep the card name', () => {
    const info: any = extractModalModesForSpellCast(CRASH, 'Crash and Burn');
    const labels = (info?.options || []).map((o: any) => String(o.label || o.description || ''));
    expect(labels.some((l: string) => /^Crash and Burn deals 6 damage/.test(l))).toBe(true);
    expect(labels.some((l: string) => /this permanent/i.test(l))).toBe(false);
  });

  it('Blizzard Brawl fights without three snow permanents', () => {
    const game = setup();
    const left = cast(game, 'Blizzard Brawl', BRAWL, ['wurm', 'giant']);
    expect(left).not.toContain('giant');
    expect(left).toContain('wurm');
    const wurm = game.state.battlefield.find((p: any) => p.id === 'wurm');
    expect(Number(wurm?.damage ?? wurm?.damageMarked ?? 0)).toBe(3);
  });
});
