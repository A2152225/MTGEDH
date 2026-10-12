import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import { runSBA } from '../src/state/modules/counters_tokens.js';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughnessForRules } from '../src/state/modules/currentPowerToughness.js';
import { hasEffectiveAbility } from '../src/socket/combat-handlers/combatLegalityGates.js';
import { permanentHasKeyword } from '../src/socket/game-actions.js';
import { applyClassLevelGatingToPermanent, splitClassLevelSections } from '../../shared/src/classLevelText.js';

const mk = (id: string, typeLine: string, oracle: string, extra: any = {}) => ({
  id, controller: 'p1', owner: 'p1', counters: {}, ...extra,
  card: { id: `${id}_c`, name: `Card ${id}`, type_line: typeLine, oracle_text: oracle, power: '2', toughness: '2' },
});
function boardState(perms: any[], extra: any = {}) {
  const state: any = { battlefield: perms, players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p1', life: { p1: 40 }, startingLife: 40, zones: {}, ...extra };
  syncDerivedContinuousEffects(state);
  return state;
}
const pt = (perm: any, state: any) => getCurrentPowerToughnessForRules(perm, state);

describe('lord self-inclusion (only "other" excludes the source)', () => {
  it('"Creatures you control have flying" gives the lord flying too', () => {
    const lord = mk('lord', 'Creature - Bird', 'Creatures you control have flying.');
    const state = boardState([lord]);
    expect(hasEffectiveAbility(lord, 'flying', [lord], 'p1').hasAbility).toBe(true);
    expect(hasEffectiveAbility(lord, 'flying', [], 'p1').hasAbility).toBe(true);
    expect(permanentHasKeyword(lord, [lord], 'p1', 'flying', state)).toBe(true);
  });

  it('"Elves you control get +1/+1" on an Elf lord buffs itself (irregular plural)', () => {
    const lord = mk('lord', 'Creature - Elf Lord', 'Elves you control get +1/+1.');
    const elf = mk('elf', 'Creature - Elf', '');
    const state = boardState([lord, elf]);
    expect(pt(lord, state)).toMatchObject({ power: 3, toughness: 3 });
    expect(pt(elf, state)).toMatchObject({ power: 3, toughness: 3 });
  });

  it('"Other Elves you control get +1/+1" does not buff itself', () => {
    const lord = mk('lord', 'Creature - Elf Lord', 'Other Elves you control get +1/+1.');
    const elf = mk('elf', 'Creature - Elf', '');
    const state = boardState([lord, elf]);
    expect(pt(lord, state)).toMatchObject({ power: 2, toughness: 2 });
    expect(pt(elf, state)).toMatchObject({ power: 3, toughness: 3 });
  });

  it('a non-Elf lord giving Elves +1/+1 does not buff itself', () => {
    const lord = mk('lord', 'Creature - Human', 'Elves you control get +1/+1.');
    const elf = mk('elf', 'Creature - Elf', '');
    const state = boardState([lord, elf]);
    expect(pt(lord, state)).toMatchObject({ power: 2, toughness: 2 });
    expect(pt(elf, state)).toMatchObject({ power: 3, toughness: 3 });
  });

  it('"Creatures you control with flying have X" includes the flying source; "Other ..." (Sephara) does not', () => {
    const angel = mk('ang', 'Creature - Angel', 'Flying\nCreatures you control with flying have vigilance.');
    const ground = mk('bear', 'Creature - Bear', '');
    boardState([angel, ground]);
    expect(hasEffectiveAbility(angel, 'vigilance', [angel, ground], 'p1').hasAbility).toBe(true);
    expect(hasEffectiveAbility(ground, 'vigilance', [angel, ground], 'p1').hasAbility).toBe(false);

    const seph = mk('seph', 'Creature - Angel', 'Flying\nOther creatures you control with flying have indestructible.');
    const flyer = mk('fly', 'Creature - Bird', 'Flying');
    const bf = [seph, flyer];
    boardState(bf);
    expect(hasEffectiveAbility(seph, 'indestructible', bf, 'p1').hasAbility).toBe(false);
    expect(hasEffectiveAbility(flyer, 'indestructible', bf, 'p1').hasAbility).toBe(true);
  });

  it('Always Watching style "Nontoken creatures you control" still skips tokens and includes the source', () => {
    const src = mk('aw', 'Creature - Human', 'Nontoken creatures you control get +1/+1 and have vigilance.');
    const token = mk('tok', 'Token Creature - Soldier', '', { isToken: true });
    const state = boardState([src, token]);
    expect(pt(src, state)).toMatchObject({ power: 3, toughness: 3 });
    expect(pt(token, state)).toMatchObject({ power: 2, toughness: 2 });
  });
});

describe('conditional self-grants follow current state', () => {
  const text = 'As long as you control another Elf, this creature gets +1/+1 and has flying.';
  it('off without the condition, on with it (P/T and keyword)', () => {
    const a = mk('a', 'Creature - Elf', text);
    const off = boardState([a]);
    expect(pt(a, off)).toMatchObject({ power: 2, toughness: 2 });
    expect(hasEffectiveAbility(a, 'flying', [a], 'p1').hasAbility).toBe(false);

    const b = mk('b', 'Creature - Elf', '');
    const on = boardState([a, b]);
    expect(pt(a, on)).toMatchObject({ power: 3, toughness: 3 });
    expect(hasEffectiveAbility(a, 'flying', [a, b], 'p1').hasAbility).toBe(true);

    // The other Elf leaves: the grant turns off again on the next sync.
    boardState([a]);
    expect(hasEffectiveAbility(a, 'flying', [a], 'p1').hasAbility).toBe(false);
  });

  it('trailing "has X as long as it\'s your turn" and threshold prefix', () => {
    const t = mk('t', 'Creature - Spirit', "This creature has flying as long as it's your turn.");
    boardState([t], { turnPlayer: 'p2' });
    expect(hasEffectiveAbility(t, 'flying', [t], 'p1').hasAbility).toBe(false);
    boardState([t], { turnPlayer: 'p1' });
    expect(hasEffectiveAbility(t, 'flying', [t], 'p1').hasAbility).toBe(true);

    const w = mk('w', 'Creature - Bear', 'Threshold \u2014 As long as seven or more cards are in your graveyard, this creature gets +1/+1 and has flying.');
    const none = boardState([w], { zones: { p1: { graveyard: [] } } });
    expect(pt(w, none)).toMatchObject({ power: 2, toughness: 2 });
    const full = boardState([w], { zones: { p1: { graveyard: new Array(7).fill({}) } } });
    expect(pt(w, full)).toMatchObject({ power: 3, toughness: 3 });
  });
});

describe('simultaneous SBA / combat deaths are one event for "one or more ... die"', () => {
  function sbaGame(oracle: string) {
    const game: any = createInitialGameState(`t_sba_${Math.random().toString(36).slice(2, 7)}`);
    game.applyEvent({ type: 'join', playerId: 'a', name: 'A' });
    game.applyEvent({ type: 'join', playerId: 'b', name: 'B' });
    game.state.turnPlayer = 'a';
    game.state.phase = 'combat';
    game.state.step = 'DAMAGE';
    game.state.stack = [];
    game.state.battlefield.push({ id: 'src', controller: 'a', owner: 'a', counters: {}, card: { id: 'src_c', name: 'Watcher', type_line: 'Enchantment', oracle_text: oracle } });
    for (const id of ['x1', 'x2', 'x3']) {
      game.state.battlefield.push({ id, controller: 'a', owner: 'a', counters: {}, damageMarked: 5, damage: 5, card: { id: `${id}_c`, name: id, type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' } });
    }
    runSBA(game);
    return (game.state.stack || []).filter((s: any) => s?.sourceName === 'Watcher').length;
  }
  it('"one or more" fires once; per-creature "dies" fires per creature', () => {
    expect(sbaGame('Whenever one or more other creatures you control die, draw a card.')).toBe(1);
    expect(sbaGame('Whenever one or more creatures die, draw a card.')).toBe(1);
    expect(sbaGame('Whenever another creature you control dies, draw a card.')).toBe(3);
  });
});

describe('Class level view data', () => {
  const full = 'Creature tokens you control get +1/+0.\n{W}: Level 2\nWhenever a token enters, draw a card.\n{3}{W}: Level 3\nCreature tokens you control get +2/+2.';
  it('splits sections and marks active ones; battlefield card carries classLevel', () => {
    const sections = splitClassLevelSections(full, 2);
    expect(sections.map((s) => [s.level, s.active])).toEqual([[1, true], [2, true], [3, false]]);
    const perm: any = { id: 'c', level: 2, card: { name: 'Talent', type_line: 'Enchantment - Class', oracle_text: full } };
    applyClassLevelGatingToPermanent(perm);
    expect(perm.card.classLevel).toBe(2);
    expect(perm.card.classFullOracleText).toBe(full);
    expect(perm.card.oracle_text).not.toContain('+2/+2');
  });
});
