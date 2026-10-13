import { beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { persistAndResolveTopOfStack } from '../src/socket/util-handlers/appendGameEvent.js';
import { createToken } from '../src/state/modules/counters_tokens.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { getEffectiveOracleText } from '../src/state/modules/effectiveOracleText.js';
import { keywordsOnPermanent } from '../src/state/modules/triggers/triggerConditionFamilyMatch.js';
import { permanentHasKeywordAbility } from '../../rules-engine/src/permanentKeywordAbilities.js';

const gameId = 'test_per_instance_mass_token_perf';
const CRUSADE = 'Whenever a creature you control enters, put a +1/+1 counter on each creature you control.';
function perm(id: string, name: string, type: string, oracle: string): any {
  return { id, controller: 'p1', owner: 'p1', tapped: false, counters: {}, card: { id: id + '_c', name, type_line: type, oracle_text: oracle, zone: 'battlefield' } };
}
async function setup(): Promise<any> {
  ResolutionQueueManager.removeQueue(gameId); games.delete(gameId as any); try { truncateEventsForUndo(gameId, 0); } catch {} await deleteGame(gameId);
  createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
  const game: any = ensureGame(gameId);
  game.state.players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }, { id: 'p2', name: 'P2', spectator: false, life: 40 }];
  game.state.life = { p1: 40, p2: 40 };
  game.state.zones = { p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 }, p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 } };
  game.state.turnPlayer = 'p1'; game.state.priority = 'p1'; game.state.phase = 'main1'; game.state.step = 'MAIN1'; game.state.stack = [];
  game.state.battlefield = [perm('crusade', "Cathars' Crusade", 'Enchantment', CRUSADE),
    perm('exemplar', 'Exemplar Hydra', 'Creature \u2014 Hydra', 'Whenever one or more +1/+1 counters are put on this creature, you gain 1 life.')];
  return game;
}
function filler(count: number): any[] {
  return Array.from({ length: count }, (_, i) => perm('f' + i, 'Grizzly Bears', 'Creature \u2014 Bear', i % 7 === 0 ? 'Whenever this creature attacks, draw a card.' : ''));
}

describe('per-instance resolution and mass token creation (perf + exactness)', () => {
  beforeAll(async () => { await initDb(); });

  it('effective oracle text still applies color-word rewrites and skips text without color words', () => {
    const state: any = { battlefield: [
      { ...perm('swirl', 'Swirl the Mists', 'Enchantment', 'As this enters, choose a color word. All instances of color words in the text of spells and permanents are changed to the chosen color word.'), chosenColorWord: 'blue' },
      ...filler(50),
    ] };
    expect(getEffectiveOracleText({ oracle_text: 'Protection from red' }, state)).toBe('Protection from blue');
    expect(getEffectiveOracleText({ oracle_text: 'Flying' }, state)).toBe('Flying');
    expect(getEffectiveOracleText({ oracle_text: 'Protection from Green' }, undefined)).toBe('Protection from Green');
  });

  it('keywordsOnPermanent matches full-battlefield keyword checks (lords, removals, attachments)', () => {
    const target = perm('t', 'Elf Warrior', 'Creature \u2014 Elf Warrior', '');
    const sword = { ...perm('sword', 'Sword', 'Artifact \u2014 Equipment', 'Equipped creature has trample.'), attachedTo: 't' };
    const scenarios: any[][] = [
      [target, perm('lord', 'Lord', 'Creature \u2014 Elf', 'Other Elves you control have flying.'), ...filler(80)],
      [target, perm('lord', 'Lord', 'Creature \u2014 Elf', 'Creatures you control have flying and lifelink.'), perm('rem', 'Clipper', 'Enchantment', 'Creatures your opponents control lose flying.'), ...filler(80)],
      [target, perm('lord', 'Lord', 'Creature \u2014 Elf', 'Creatures you control have flying.'), { ...perm('rem2', 'Clip', 'Enchantment', 'All creatures lose flying.'), controller: 'p2' }, sword, ...filler(80)],
    ];
    for (const battlefield of scenarios) {
      const fast = keywordsOnPermanent(target, battlefield).sort();
      const full = ['flying', 'lifelink', 'trample', 'haste', 'deathtouch', 'vigilance', 'menace', 'reach']
        .filter((kw) => permanentHasKeywordAbility(target, kw, battlefield));
      for (const kw of full) expect(fast).toContain(kw);
      for (const kw of ['flying', 'lifelink', 'trample']) expect(fast.includes(kw)).toBe(full.includes(kw));
    }
    expect(keywordsOnPermanent(target, scenarios[0])).toContain('flying');
    expect(keywordsOnPermanent(target, scenarios[2])).not.toContain('flying');
    expect(keywordsOnPermanent(target, scenarios[2])).toContain('trample');
  });

  it('per-instance Crusade run with a counter watcher at 460 creatures stays fast and exact', async () => {
    const game = await setup();
    createToken(game, 'p1' as any, 'Soldier', 360, 1, 1, { typeLine: 'Token Artifact Creature \u2014 Soldier' } as any);
    game.state.stack = [];
    createToken(game, 'p1' as any, 'Mite', 100, 1, 1, { typeLine: 'Token Artifact Creature \u2014 Phyrexian Mite' } as any);
    const t0 = performance.now(); let n = 0; let crusades = 0;
    while ((game.state.stack || []).length > 0 && n < 400) {
      const top = game.state.stack[game.state.stack.length - 1];
      if (String(top.sourceName) === "Cathars' Crusade") crusades++;
      persistAndResolveTopOfStack(game, gameId, {}); n++;
    }
    const ms = performance.now() - t0;
    console.log('[perf] per-instance watcher run: resolutions=' + n + ' total=' + ms.toFixed(0) + 'ms per=' + (ms / n).toFixed(1) + 'ms');
    expect(crusades).toBe(100);
    expect(game.state.stack.length).toBe(0);
    expect(game.state.life.p1).toBe(140);
    const hydra = game.state.battlefield.find((p: any) => p.id === 'exemplar');
    expect(hydra.counters['+1/+1']).toBe(100);
    expect(ms / n).toBeLessThan(200);
  }, 300000);

  it('creating 300 tokens on a ~300 permanent board stays fast and triggers once per token', async () => {
    const game = await setup();
    createToken(game, 'p1' as any, 'Soldier', 300, 1, 1, { typeLine: 'Token Artifact Creature \u2014 Soldier' } as any);
    game.state.stack = [];
    const t0 = performance.now();
    createToken(game, 'p1' as any, 'Mite', 300, 1, 1, { typeLine: 'Token Artifact Creature \u2014 Phyrexian Mite' } as any);
    const ms = performance.now() - t0;
    console.log('[perf] create 300 tokens on 302 board: ' + ms.toFixed(0) + 'ms');
    expect(game.state.stack.length).toBe(300);
    expect(game.state.battlefield.length).toBe(602);
    expect(ms).toBeLessThan(5000);
  }, 300000);
});
