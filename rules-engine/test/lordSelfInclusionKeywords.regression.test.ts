import { describe, expect, it } from 'vitest';
import { permanentHasKeywordAbility } from '../src/permanentKeywordAbilities.js';
import { oracleTextHasOwnKeyword } from '../src/oracleOwnKeywordText.js';

const perm = (id: string, typeLine: string, oracle: string, extra: any = {}) => ({ id, controller: 'p1', ...extra, card: { name: id, type_line: typeLine, oracle_text: oracle } });

describe('lord self-inclusion and conditional self-grants in the keyword helper', () => {
  it('a lord gets its own non-"other" grant even without a battlefield list; not printed-own', () => {
    const lord = perm('lord', 'Creature - Bird', 'Creatures you control have haste, flying.');
    expect(oracleTextHasOwnKeyword(lord.card.oracle_text, 'flying')).toBe(false);
    expect(permanentHasKeywordAbility(lord, 'flying')).toBe(true);
    expect(permanentHasKeywordAbility(lord, 'flying', [])).toBe(true);
    const other = perm('o', 'Creature - Bird', 'Other creatures you control have flying.');
    expect(permanentHasKeywordAbility(other, 'flying', [other])).toBe(false);
    const elfLord = perm('e', 'Creature - Human', 'Elves you control have deathtouch.');
    expect(permanentHasKeywordAbility(elfLord, 'deathtouch', [elfLord])).toBe(false);
  });

  it('"creatures you control with flying have X" applies to the source only when it flies', () => {
    const angel = perm('a', 'Creature - Angel', 'Flying\nCreatures you control with flying have vigilance.');
    const bear = perm('b', 'Creature - Bear', '');
    expect(permanentHasKeywordAbility(angel, 'vigilance', [angel, bear])).toBe(true);
    expect(permanentHasKeywordAbility(bear, 'vigilance', [angel, bear])).toBe(false);
  });

  it('conditional self-grants are not always-on; the server-evaluated stamp turns them on', () => {
    const text = 'As long as you control another Elf, this creature has flying.';
    const c = perm('c', 'Creature - Elf', text);
    expect(oracleTextHasOwnKeyword(text, 'flying')).toBe(false);
    expect(permanentHasKeywordAbility(c, 'flying', [c])).toBe(false);
    expect(permanentHasKeywordAbility({ ...c, continuousAbilities: ['flying'] }, 'flying', [c])).toBe(true);
    const lordCond = perm('l', 'Creature - Human', 'As long as it\'s your turn, creatures you control have flying.');
    expect(permanentHasKeywordAbility(lordCond, 'flying', [lordCond])).toBe(false);
  });
});
