import { describe, expect, it } from 'vitest';

import { parseTriggerClause } from '../src/triggerCondition/parseFamilies';

const cond = (text: string, name = 'Sample Card'): any => parseTriggerClause(text, name);

describe('trigger IR: top census fallbacks', () => {
  it('"whenever you attack" is one-or-more creatures you control attacking', () => {
    const p = cond("Whenever you attack, create a 1/1 white Soldier creature token.");
    expect(p?.effect).toMatch(/create/);
    expect(p.condition.event).toBe('attacks');
    expect(p.condition.quantity).toBe('one_or_more');
    expect(p.condition.alternatives[0].controller).toBe('you');
  });

  it('suspend "when the last is removed" and the long form parse as last_counter_removed', () => {
    const short = cond('When the last is removed, you may cast it without paying its mana cost.');
    expect(short?.condition.event).toBe('last_counter_removed');
    expect(short.condition.placedCounter).toBe('time');
    const long = cond("When the last time counter is removed from it while it's exiled, draw a card.");
    expect(long?.condition.event).toBe('last_counter_removed');
    expect(long.effect).toMatch(/^draw a card/);
  });

  it('"when you cast this spell" is cast_self from the source itself', () => {
    const p = cond('When you cast this spell, copy it.');
    expect(p?.condition.event).toBe('cast_self');
    expect(p.condition.alternatives[0].source).toBe('self');
  });

  it('"enchanted/equipped creature dies" binds to the attached creature', () => {
    const ench = cond("When enchanted creature dies, return that card to its owner's hand.");
    expect(ench?.condition.event).toBe('dies');
    expect(ench.condition.alternatives[0].source).toBe('enchanted');
    const eq = cond('Whenever equipped creature dies, draw a card.');
    expect(eq?.condition.alternatives[0].source).toBe('equipped');
    expect(cond('Whenever a creature dies, draw a card.')?.condition.alternatives[0].source).toBe('any');
  });

  it('"this creature becomes blocked" parses with self source; other subjects stay legacy', () => {
    for (const text of [
      'Whenever this creature becomes blocked, untap up to three lands you control.',
      'Whenever this creature becomes blocked by a creature, it gets +1/+1 until end of turn.',
    ]) {
      const p = cond(text);
      expect(p?.condition.event).toBe('becomes_blocked');
      expect(p.condition.alternatives[0].source).toBe('self');
    }
    expect(cond('Whenever a creature you control becomes blocked, draw a card.')?.condition.event).toBe('becomes_blocked');
  });
});
