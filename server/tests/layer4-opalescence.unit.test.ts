import { describe, expect, it } from 'vitest';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
import { getContinuousPTBonusForPermanent } from '../src/state/modules/staticEffectSpec';
import { isCreatureNow } from '../src/state/creatureTypeNow';
import { stampLayer4TypeSetting, layer4AddedTypesFor } from '../src/state/modules/layer4TypeSetting';

function perm(id: string, name: string, type_line: string, oracle_text: string, cmc: number) {
  return { id, controller: 'p1', owner: 'p1', tapped: false, counters: {}, timestamp: Number(id.replace(/\D/g, '')) || 1,
    card: { id, name, type_line, oracle_text, cmc } } as any;
}
const OPAL = 'Each other non-Aura enchantment is a creature in addition to its other types and has base power and base toughness each equal to its mana value.';

describe('layer 4 type-setting: Opalescence', () => {
  const opal = perm('e1', 'Opalescence', 'Enchantment', OPAL, 4);
  const rhystic = perm('e2', 'Rhystic Study', 'Enchantment', 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.', 3);
  const aura = perm('e3', 'Pacifism', 'Enchantment \u2014 Aura', 'Enchant creature', 2);

  it("an affected enchantment is a creature with P/T equal to its mana value", () => {
    const state: any = { battlefield: [opal, rhystic], players: [{ id: 'p1' }] };
    stampLayer4TypeSetting(state);
    expect(isCreatureNow(rhystic)).toBe(true);
    const pt = getCurrentPowerToughness(rhystic, state);
    expect(pt?.power).toBe(3);
    expect(pt?.toughness).toBe(3);
  });

  it('excludes Auras and Opalescence itself', () => {
    const state: any = { battlefield: [opal, rhystic, aura], players: [{ id: 'p1' }] };
    expect(layer4AddedTypesFor(aura, state)).toEqual([]);
    expect(layer4AddedTypesFor(opal, state)).toEqual([]);
    stampLayer4TypeSetting(state);
    expect(isCreatureNow(aura)).toBe(false);
    expect(isCreatureNow(opal)).toBe(false);
  });

  it('type-dependent statics see the new creature type', () => {
    const anthem = perm('e4', 'Glorious Anthem', 'Enchantment', 'Creatures you control get +1/+1.', 3);
    const state: any = { battlefield: [opal, rhystic, anthem], players: [{ id: 'p1' }] };
    expect(getContinuousPTBonusForPermanent(rhystic, state).power).toBe(1);
    expect(getCurrentPowerToughness(rhystic, state)?.power).toBe(4);
    // Glorious Anthem is itself an animated 3/3 that gets its own bonus.
    expect(getCurrentPowerToughness(anthem, state)?.power).toBe(4);
  });
});
