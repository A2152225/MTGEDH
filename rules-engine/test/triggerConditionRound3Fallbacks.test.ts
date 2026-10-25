import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../src/triggerCondition/index.js';
import type { TriggerMatchPermanent, TriggerMatchSource } from '../src/triggerCondition/index.js';

const self: TriggerMatchSource = { id: 'me', controllerId: 'p1' };
const selfObj: TriggerMatchPermanent = { id: 'me', typeLine: 'Creature - Horse', controllerId: 'p1' };
const parse = (text: string) => parseTriggerClause(text) as any;

describe('round 3 fallback families', () => {
  it('dies or is exiled pairs dies with exiled', () => {
    const p = parse('When this creature dies or is exiled, draw a card.');
    expect(p?.condition.event).toBe('dies');
    expect(p?.condition.pairedEvent).toBe('exiled');
    expect(p?.effect).toMatch(/^draw a card/);
  });

  it('magecraft keeps the cast half as an instant or sorcery spell_cast', () => {
    const p = parse('Whenever you cast or copy an instant or sorcery spell, scry 1.');
    expect(p?.condition.event).toBe('spell_cast');
    const sorcery = { id: 's', typeLine: 'Sorcery', controllerId: 'p1' };
    const creature = { id: 'c', typeLine: 'Creature - Elf', controllerId: 'p1' };
    expect(triggerConditionMatches(p.condition, sorcery, self)).toBe(true);
    expect(triggerConditionMatches(p.condition, creature, self)).toBe(false);
  });

  it('one or more creatures you control deal combat damage is one_or_more', () => {
    const p = parse('Whenever one or more creatures you control deal combat damage to a player, draw a card.');
    expect(p?.condition.event).toBe('deals_combat_damage_to_player');
    expect(p?.condition.quantity).toBe('one_or_more');
  });

  it("attacks and isn't blocked gets its own event", () => {
    const p = parse("Whenever this creature attacks and isn't blocked, it deals 2 damage to defending player.");
    expect(p?.condition.event).toBe('attacks_unblocked');
  });

  it('attacks while saddled requires a saddled source', () => {
    const p = parse('Whenever this creature attacks while saddled, draw a card.');
    expect(p?.condition.event).toBe('attacks');
    expect(triggerConditionMatches(p.condition, selfObj, self)).toBe(false);
    expect(triggerConditionMatches(p.condition, selfObj, { ...self, saddled: true })).toBe(true);
  });

  it('historic spell parses and matches legendary or artifact spells only', () => {
    const p = parse('Whenever you cast a historic spell, draw a card.');
    expect(p?.condition.event).toBe('spell_cast');
    expect(triggerConditionMatches(p.condition, { id: 'a', typeLine: 'Artifact', controllerId: 'p1' }, self)).toBe(true);
    expect(triggerConditionMatches(p.condition, { id: 'b', typeLine: 'Instant', controllerId: 'p1' }, self)).toBe(false);
  });

  it('blocks or becomes blocked pairs the two events; a partner filter fails closed', () => {
    const plain = parse('Whenever this creature blocks or becomes blocked by a creature, it gets +1/+1 until end of turn.');
    expect(plain?.condition.event).toBe('blocks');
    expect(plain?.condition.pairedEvent).toBe('becomes_blocked');
    expect(plain?.condition.blockPartner).toBeUndefined();
    expect(triggerConditionMatches(plain.condition, selfObj, self)).toBe(true);

    const filtered = parse('Whenever this creature blocks or becomes blocked by a nonblack creature, destroy that creature.');
    expect(filtered?.condition.blockPartner).toBeTruthy();
    expect(triggerConditionMatches(filtered.condition, selfObj, self)).toBe(false);
    const red = { id: 'x', typeLine: 'Creature - Goblin', controllerId: 'p2', colors: ['R'] };
    const black = { id: 'y', typeLine: 'Creature - Zombie', controllerId: 'p2', colors: ['B'] };
    expect(triggerConditionMatches(filtered.condition, selfObj, self, { blockPartner: red })).toBe(true);
    expect(triggerConditionMatches(filtered.condition, selfObj, self, { blockPartner: black })).toBe(false);
  });
});
