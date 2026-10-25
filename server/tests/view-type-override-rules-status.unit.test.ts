import { describe, expect, it } from 'vitest';
import { computePermanentRulesStatus } from '../src/state/modules/viewPermanentRulesStatus.js';
import { stampAttachedTypeSettingOverrides } from '../src/state/modules/attachedTypeSettingStamp.js';

const card = (name: string, type_line: string, oracle_text = '', extra: any = {}) => ({ name, type_line, oracle_text, ...extra });

describe('view rulesStatus: type overrides and conditional attached P/T', () => {
  it('Imprisoned in the Moon host shows the override type line, colourless, not a creature', () => {
    const state: any = { battlefield: [
      { id: 'c1', controller: 'p2', owner: 'p2', card: card('Grizzly Bears', 'Creature \u2014 Bear', '', { colors: ['G'], power: '2', toughness: '2' }) },
      { id: 'a1', controller: 'p1', owner: 'p1', attachedTo: 'c1', card: card('Imprisoned in the Moon', 'Enchantment \u2014 Aura', 'Enchant creature, land, or planeswalker\nEnchanted permanent is a colorless land with "{T}: Add {C}" and loses all other card types and abilities.') },
    ] };
    stampAttachedTypeSettingOverrides(state);
    const rs = computePermanentRulesStatus(state.battlefield[0], state)!;
    expect(rs.typeOverride).toEqual({ typeLine: 'Land', colorless: true, isCreature: false, sourceName: 'Imprisoned in the Moon' });
  });

  it('Ensoul Artifact host is flagged as animated', () => {
    const state: any = { battlefield: [
      { id: 'r1', controller: 'p1', owner: 'p1', card: card('Sol Ring', 'Artifact', '{T}: Add {C}{C}.') },
      { id: 'e1', controller: 'p1', owner: 'p1', attachedTo: 'r1', card: card('Ensoul Artifact', 'Enchantment \u2014 Aura', 'Enchant artifact\nEnchanted artifact is a creature with base power and toughness 5/5 in addition to its other types.') },
    ] };
    stampAttachedTypeSettingOverrides(state);
    expect(computePermanentRulesStatus(state.battlefield[0], state)?.animatedByAttachment).toBe(true);
  });

  it('Black Scarab bonus is active only while an opponent controls a white permanent', () => {
    const scarab = { id: 's1', controller: 'p1', owner: 'p1', attachedTo: 'c1', card: card('Black Scarab', 'Enchantment \u2014 Aura', "Enchant creature\nEnchanted creature can't be blocked by black creatures.\nEnchanted creature gets +2/+2 as long as an opponent controls a black permanent.") };
    const host = { id: 'c1', controller: 'p1', owner: 'p1', card: card('Bear', 'Creature \u2014 Bear', '', { colors: ['G'] }) };
    const off: any = { battlefield: [host, scarab] };
    expect(computePermanentRulesStatus(host, off)?.conditionalPtBonuses).toMatchObject([{ sourceName: 'Black Scarab', power: 2, toughness: 2, active: false }]);
    const on: any = { battlefield: [host, scarab, { id: 'o1', controller: 'p2', owner: 'p2', card: card('Ghoul', 'Creature \u2014 Zombie', '', { colors: ['B'] }) }] };
    expect(computePermanentRulesStatus(host, on)?.conditionalPtBonuses?.[0].active).toBe(true);
  });

  it("Serra's Boon reports its Otherwise bonus with the condition", () => {
    const aura = { id: 'b1', controller: 'p1', owner: 'p1', attachedTo: 'c1', card: card("Serra's Boon", 'Enchantment \u2014 Aura', "Enchant creature\nEnchanted creature gets +1/+2 as long as it's white. Otherwise, it gets -2/-1.") };
    const host: any = { id: 'c1', controller: 'p1', owner: 'p1', card: card('Bear', 'Creature \u2014 Bear', '', { colors: ['G'] }) };
    const b = computePermanentRulesStatus(host, { battlefield: [host, aura] })?.conditionalPtBonuses || [];
    expect(b.map((x) => [x.power, x.toughness, x.active, !!x.otherwise, x.condition])).toEqual([[1, 2, false, false, "it's white"], [-2, -1, true, true, "it's white"]]);
  });
  it('Legendary host keeps supertype; later Ensoul makes Land Creature', () => {
    const state: any = { battlefield: [
      { id: 'c1', controller: 'p2', owner: 'p2', card: card('Thalia', 'Legendary Creature \u2014 Human', 'First strike', { colors: ['W'] }) },
      { id: 'a1', controller: 'p1', owner: 'p1', attachedTo: 'c1', timestamp: 1, card: card('Imprisoned in the Moon', 'Enchantment \u2014 Aura', 'Enchanted permanent is a colorless land with "{T}: Add {C}" and loses all other card types and abilities.') },
      { id: 'e1', controller: 'p1', owner: 'p1', attachedTo: 'c1', timestamp: 2, card: card('Ensoul Artifact', 'Enchantment \u2014 Aura', 'Enchanted artifact is a creature with base power and toughness 5/5 in addition to its other types.') },
    ] };
    stampAttachedTypeSettingOverrides(state);
    const o = computePermanentRulesStatus(state.battlefield[0], state)?.typeOverride;
    expect(o?.typeLine).toBe('Legendary Land Creature');
    expect(o?.isCreature).toBe(true);
    expect(o?.colorless).toBe(true);
  });
  it('Twisted Embrace-style bonus is inactive on a host that is no longer a creature', () => {
    const aura = { id: 't1', controller: 'p1', owner: 'p1', attachedTo: 'c1', card: card('Embrace', 'Enchantment \u2014 Aura', 'Enchant permanent\nAs long as enchanted permanent is a creature, it gets +1/+1.') };
    const host: any = { id: 'c1', controller: 'p1', owner: 'p1', card: card('Bear', 'Creature \u2014 Bear') };
    expect(computePermanentRulesStatus(host, { battlefield: [host, aura] })?.conditionalPtBonuses?.[0].active).toBe(true);
    const moon = { ...host, notCreature: true, typeSetOverride: { typeLine: 'Land', cardTypes: ['land'], subtypes: [], colorless: true } };
    expect(computePermanentRulesStatus(moon, { battlefield: [moon, aura] })?.conditionalPtBonuses?.[0].active).toBe(false);
  });
});