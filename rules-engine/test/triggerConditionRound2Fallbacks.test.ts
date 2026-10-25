import { describe, expect, it } from 'vitest';

import { parseTriggerClause } from '../src/triggerCondition/parseFamilies';
import { stripReminderParentheticals } from '../src/oracleReminderText';

const cond = (text: string): any => parseTriggerClause(text, 'Sample Card');

describe('trigger IR: second census batch', () => {
  it('"draw your second card each turn" is draws_card with ordinal second', () => {
    const p = cond('Whenever you draw your second card each turn, put a +1/+1 counter on this creature.');
    expect(p.condition.event).toBe('draws_card');
    expect(p.condition.ordinal).toBe('second');
    expect(p.condition.alternatives[0].controller).toBe('you');
    expect(cond('Whenever an opponent draws their second card each turn, you gain 1 life.').condition.alternatives[0].controller).toBe('not_you');
  });

  it('"a Spirit or Arcane spell" is a two-way subtype OR', () => {
    const p = cond('Whenever you cast a Spirit or Arcane spell, this creature gains flying until end of turn.');
    expect(p.condition.event).toBe('spell_cast');
    expect(p.condition.alternatives[0].subject.groups.map((g: any) => g.subtypes[0])).toEqual(['spirit', 'arcane']);
  });

  it('heroic is spell_cast with targets self', () => {
    const p = cond('Whenever you cast a spell that targets this creature, this creature gets +2/+0 until end of turn.');
    expect(p.condition.event).toBe('spell_cast');
    expect(p.condition.targets).toBe('self');
  });

  it('equipped creature combat damage uses the equipped source relation', () => {
    const p = cond('Whenever equipped creature deals combat damage to a player, you gain 3 life.');
    expect(p.condition.event).toBe('deals_combat_damage_to_player');
    expect(p.condition.alternatives[0].source).toBe('equipped');
  });

  it('"when this Siege enters" is a self enters trigger', () => {
    const p = cond('When this Siege enters, target player sacrifices a creature.');
    expect(p.condition.event).toBe('enters');
    expect(p.condition.alternatives[0].source).toBe('self');
  });
});

describe('Suspend reminder text', () => {
  it('strips "Suspend N\u2014{cost} (...)" reminder text', () => {
    const out = stripReminderParentheticals('Suspend 3\u2014{0} (Rather than cast this card from your hand, pay {0} and exile it with three time counters on it. At the beginning of your upkeep, remove a time counter. When the last is removed, you may cast it without paying its mana cost.)');
    expect(out).not.toMatch(/last is removed/);
    expect(out).toMatch(/^Suspend 3/);
  });

  it('still strips plain keyword reminders and keeps non-reminder parentheticals', () => {
    expect(stripReminderParentheticals('Kicker {2} (You may pay an additional {2} as you cast this spell.)')).not.toMatch(/additional/);
    expect(stripReminderParentheticals('Flying (This creature can\'t be blocked except by creatures with flying or reach.)')).not.toMatch(/blocked/);
    expect(stripReminderParentheticals('When this creature enters, choose one (you may choose the same mode more than once).')).toMatch(/same mode/);
  });
});
