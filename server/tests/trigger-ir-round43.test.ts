import { describe, expect, it } from 'vitest';
import { permanentToTriggerMatch } from '../src/state/modules/triggers/triggerConditionFamilyMatch.js';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';

const cond = (s: string) => parseTriggerClause(s)?.condition as any;
const spell = (type_line: string, oracle_text = '') => permanentToTriggerMatch({ id: 'x', controller: 'p1', card: { id: 'x', name: 'X', type_line, oracle_text } } as any, 'p1') as any;
const src = { controllerId: 'p1' } as any;

describe('round 43 cast qualifiers', () => {
  it('<type-negation> or <subtype> spell', () => {
    const c = cond('Whenever you cast a noncreature or Dragon spell, draw a card.');
    expect(c?.event).toBe('spell_cast');
    expect(triggerConditionMatches(c, spell('Instant'), src)).toBe(true);
    expect(triggerConditionMatches(c, spell('Creature - Dragon'), src)).toBe(true);
    expect(triggerConditionMatches(c, spell('Creature - Elf'), src)).toBe(false);
    const v = cond('Whenever you cast a nonartifact or Vehicle spell, draw a card.');
    expect(triggerConditionMatches(v, spell('Artifact - Vehicle'), src)).toBe(true);
    expect(triggerConditionMatches(v, spell('Artifact - Equipment'), src)).toBe(false);
  });
  it('plural and singular power greater than base power', () => {
    const p = cond('Whenever one or more creatures you control with power greater than their base power attack, draw a card.');
    expect(p?.event).toBe('attacks');
    expect(p.quantity).toBe('one_or_more');
    expect(p.alternatives[0].subject.powerAboveBase).toBe(true);
    expect(cond('Whenever a creature you control with power greater than its base power attacks, draw a card.').alternatives[0].subject.powerAboveBase).toBe(true);
  });
  it('third / fourth spell, that has <keyword>, from a graveyard', () => {
    const t3 = cond('Whenever you cast your third spell each turn, draw a card.');
    expect(triggerConditionMatches(t3, spell('Instant'), src, { spellOrdinal: 3 } as any)).toBe(true);
    expect(triggerConditionMatches(t3, spell('Instant'), src, { spellOrdinal: 2 } as any)).toBe(false);
    const cv = cond('Whenever you cast a spell that has convoke, draw a card.');
    expect(triggerConditionMatches(cv, spell('Creature - Elf', 'Convoke'), src)).toBe(true);
    expect(triggerConditionMatches(cv, spell('Creature - Elf'), src)).toBe(false);
    expect(cond('Whenever a player casts a spell from a graveyard, draw a card.').castFromZone).toBe('graveyard');
  });
});
