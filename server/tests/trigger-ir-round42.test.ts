import { describe, expect, it } from 'vitest';
import { permanentToTriggerMatch } from '../src/state/modules/triggers/triggerConditionFamilyMatch.js';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';

const cond = (s: string) => parseTriggerClause(s)?.condition as any;
const spell = (type_line: string, oracle_text = '') => permanentToTriggerMatch({ id: 'x', controller: 'p1', card: { id: 'x', name: 'X', type_line, oracle_text } } as any, 'p1') as any;
const src = { controllerId: 'p1' } as any;

describe('round 42 cast-trigger long tail', () => {
  it('a spell with <keyword>', () => {
    for (const kw of ['cascade', 'convoke', 'flash']) {
      const c = cond(`Whenever you cast a spell with ${kw}, draw a card.`);
      expect(c?.event).toBe('spell_cast');
      expect(c.alternatives[0].subject.keywordsWith).toEqual([kw]);
    }
    const c = cond('Whenever you cast a spell with cascade, draw a card.');
    expect(triggerConditionMatches(c, spell('Creature - Elf', 'Cascade'), src)).toBe(true);
    expect(triggerConditionMatches(c, spell('Creature - Elf', 'Trample'), src)).toBe(false);
    const fly = cond('Whenever you cast a creature spell with flying, draw a card.');
    expect(triggerConditionMatches(fly, spell('Creature - Bird', 'Flying'), src)).toBe(true);
    expect(triggerConditionMatches(fly, spell('Instant', 'Flying'), src)).toBe(false);
    expect(cond('Whenever you cast a spell with the chosen name, draw a card.')?.event).not.toBe('spell_cast');
  });
  it('outlaw expands to Assassin/Mercenary/Pirate/Rogue/Warlock', () => {
    const c = cond('Whenever you cast an outlaw spell, draw a card.');
    expect(triggerConditionMatches(c, spell('Creature - Human Pirate'), src)).toBe(true);
    expect(triggerConditionMatches(c, spell('Creature - Human Warlock'), src)).toBe(true);
    expect(triggerConditionMatches(c, spell('Creature - Human Wizard'), src)).toBe(false);
  });
  it('during combat fails only when the context says not in combat', () => {
    const c = cond('Whenever you cast a spell during combat, draw a card.');
    expect(c.duringCombat).toBe(true);
    const s = spell('Instant');
    expect(triggerConditionMatches(c, s, src, { inCombat: true } as any)).toBe(true);
    expect(triggerConditionMatches(c, s, src, { inCombat: false } as any)).toBe(false);
  });
});
