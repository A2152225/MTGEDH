import { describe, it, expect } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../src/triggerCondition/index';

const src = { id: 'src', controllerId: 'p1' };
const perm = (over: any = {}) => ({ id: 'x', typeLine: 'Creature - Bear', controllerId: 'p1', ...over });

describe('trigger IR round 4 fallbacks', () => {
  it('"a creature you control becomes blocked" parses as becomes_blocked watcher', () => {
    const r = parseTriggerClause('Whenever a creature you control becomes blocked, it gets +1/+1 until end of turn.', 'X');
    expect(r?.condition.event).toBe('becomes_blocked');
    expect(r?.condition.alternatives[0].controller).toBe('you');
    expect(triggerConditionMatches(r!.condition, perm(), src)).toBe(true);
    expect(triggerConditionMatches(r!.condition, perm({ controllerId: 'p2' }), src)).toBe(false);
  });

  it('enchanted creature becomes blocked uses the enchanted source relation', () => {
    const r = parseTriggerClause('Whenever enchanted creature becomes blocked, destroy it.', 'X');
    expect(r?.condition.alternatives[0].source).toBe('enchanted');
    expect(triggerConditionMatches(r!.condition, perm({ id: 'a1' }), { ...src, attachedToId: 'a1' })).toBe(true);
    expect(triggerConditionMatches(r!.condition, perm({ id: 'a2' }), { ...src, attachedToId: 'a1' })).toBe(false);
  });

  it('becomes blocked by an artifact creature needs a matching blockPartner', () => {
    const r = parseTriggerClause('Whenever this creature becomes blocked by an artifact creature, destroy that creature.', 'X');
    expect(r?.condition.blockPartner).toBeTruthy();
    const self = perm({ id: 'src' });
    expect(triggerConditionMatches(r!.condition, self, src)).toBe(false);
    expect(triggerConditionMatches(r!.condition, self, src, { blockPartner: perm({ id: 'g', typeLine: 'Artifact Creature - Golem' }) })).toBe(true);
    expect(triggerConditionMatches(r!.condition, self, src, { blockPartner: perm({ id: 'b' }) })).toBe(false);
  });

  it('"a creature you control attacks and isn\'t blocked" parses as attacks_unblocked', () => {
    const r = parseTriggerClause("Whenever a creature you control attacks and isn't blocked, draw a card.", 'X');
    expect(r?.condition.event).toBe('attacks_unblocked');
    expect(r?.condition.alternatives[0].controller).toBe('you');
  });

  it('"you control with power N or greater" places the controller before the qualifier', () => {
    const r = parseTriggerClause('Whenever a creature you control with power 4 or greater enters, draw a card.', 'X');
    expect(r?.condition.event).toBe('enters');
    expect(triggerConditionMatches(r!.condition, perm({ power: 4 }), src)).toBe(true);
    expect(triggerConditionMatches(r!.condition, perm({ power: 3 }), src)).toBe(false);
    expect(triggerConditionMatches(r!.condition, perm({ power: 5, controllerId: 'p2' }), src)).toBe(false);
  });

  it('"you control with a +1/+1 counter on it dies" keeps the counter filter', () => {
    const r = parseTriggerClause('Whenever a creature you control with a +1/+1 counter on it dies, draw a card.', 'X');
    expect(r?.condition.event).toBe('dies');
    expect(triggerConditionMatches(r!.condition, perm({ counters: { '+1/+1': 1 } }), src)).toBe(true);
    expect(triggerConditionMatches(r!.condition, perm({ counters: {} }), src)).toBe(false);
  });

  it('multicolored / colorless spell filters count colours', () => {
    const multi = parseTriggerClause('Whenever you cast a multicolored spell, draw a card.', 'X');
    const colorless = parseTriggerClause('Whenever you cast a colorless spell, draw a card.', 'X');
    expect(multi?.condition.event).toBe('spell_cast');
    expect(colorless?.condition.event).toBe('spell_cast');
    const spell = (colors: string[]) => ({ id: 's', typeLine: 'Instant', controllerId: 'p1', colors });
    expect(triggerConditionMatches(multi!.condition, spell(['w', 'u']), src)).toBe(true);
    expect(triggerConditionMatches(multi!.condition, spell(['w']), src)).toBe(false);
    expect(triggerConditionMatches(colorless!.condition, spell([]), src)).toBe(true);
    expect(triggerConditionMatches(colorless!.condition, spell(['r']), src)).toBe(false);
  });
});
