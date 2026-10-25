import { describe, expect, it } from 'vitest';
import { orderEffectsByDependency } from '../../rules-engine/src/layerDependencyOrder';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
import { stampLayer4TypeSetting } from '../src/state/modules/layer4TypeSetting';
import { getEffectiveBasicLandTypes } from '../src/state/modules/mana-abilities-handlers/manaAbilityLandTypeModifiers';

function perm(id: string, name: string, type_line: string, oracle_text: string, cmc = 0, extra: any = {}) {
  return { id, controller: 'p1', owner: 'p1', tapped: false, counters: {},
    card: { id, name, type_line, oracle_text, cmc, ...extra } } as any;
}

describe('orderEffectsByDependency (CR 613.8)', () => {
  const ts = (e: any) => e.ts;
  it('plain timestamp order without dependencies', () => {
    const out = orderEffectsByDependency([{ id: 'b', ts: 2 }, { id: 'a', ts: 1 }], { timestampOf: ts, dependsOn: () => false });
    expect(out.map((e) => e.id)).toEqual(['a', 'b']);
  });
  it('a dependent effect waits for the effect it depends on', () => {
    const effects = [{ id: 'urborg', ts: 1 }, { id: 'moon', ts: 2 }, { id: 'other', ts: 3 }];
    const out = orderEffectsByDependency(effects, { timestampOf: ts, dependsOn: (a, b) => a.id === 'urborg' && b.id === 'moon' });
    expect(out.map((e) => e.id)).toEqual(['moon', 'urborg', 'other']);
  });
  it('a dependency loop falls back to timestamp order (613.8b)', () => {
    const effects = [{ id: 'y', ts: 2 }, { id: 'x', ts: 1 }, { id: 'z', ts: 0 }];
    const loop = (a: any, b: any) => (a.id === 'x' && b.id === 'y') || (a.id === 'y' && b.id === 'x');
    expect(orderEffectsByDependency(effects, { timestampOf: ts, dependsOn: loop }).map((e) => e.id)).toEqual(['z', 'x', 'y']);
  });
});

// Rulings (rulings.json, Opalescence / Humility, 2009-10-01): layer 4 Opalescence animates Humility and Worship;
// layer 6 Humility strips their abilities; in 7b both set-base effects still apply, in timestamp order.
describe('Humility + Opalescence', () => {
  const HUMILITY = 'All creatures lose all abilities and have base power and toughness 1/1.';
  const OPAL = 'Each other non-Aura enchantment is a creature in addition to its other types and has base power and base toughness each equal to its mana value.';
  const make = () => ({
    opal: perm('e_opal', 'Opalescence', 'Enchantment', OPAL, 4),
    humility: perm('e_hum', 'Humility', 'Enchantment', HUMILITY, 4),
    worship: perm('e_wor', 'Worship', 'Enchantment', "If you control a creature, damage that would reduce your life total to less than 1 reduces it to 1 instead.", 4),
    bear: perm('c_bear', 'Grizzly Bears', 'Creature \u2014 Bear', '', 2, { power: '2', toughness: '2' }),
  });
  const pt = (p: any, state: any) => { const r = getCurrentPowerToughness(p, state); return [r?.power, r?.toughness]; };

  it('Opalescence first, Humility later: everything is 1/1', () => {
    const { opal, humility, worship, bear } = make();
    const state: any = { battlefield: [opal, humility, worship, bear], players: [{ id: 'p1' }] };
    stampLayer4TypeSetting(state);
    expect(pt(humility, state)).toEqual([1, 1]);
    expect(pt(worship, state)).toEqual([1, 1]);
    expect(pt(bear, state)).toEqual([1, 1]);
  });

  it('Humility first, Opalescence later: animated enchantments are 4/4, other creatures 1/1', () => {
    const { opal, humility, worship, bear } = make();
    const state: any = { battlefield: [humility, opal, worship, bear], players: [{ id: 'p1' }] };
    stampLayer4TypeSetting(state);
    expect(pt(humility, state)).toEqual([4, 4]);
    expect(pt(worship, state)).toEqual([4, 4]);
    expect(pt(bear, state)).toEqual([1, 1]);
  });
});

// Ruling (Urborg, Tomb of Yawgmoth, 2021-03-19): Blood Moon makes Urborg lose its ability, so it makes no Swamps
// no matter in what order the effects started to apply.
describe('Blood Moon + Urborg, Tomb of Yawgmoth', () => {
  const make = () => ({
    moon: perm('e_moon', 'Blood Moon', 'Enchantment', 'Nonbasic lands are Mountains.', 3),
    urborg: perm('l_urb', 'Urborg, Tomb of Yawgmoth', 'Legendary Land', 'Each land is a Swamp in addition to its other land types.'),
    forest: perm('l_for', 'Forest', 'Basic Land \u2014 Forest', '({T}: Add {G}.)'),
    tower: perm('l_tow', 'Command Tower', 'Land', '{T}: Add one mana of any color in your commander\'s color identity.'),
  });
  for (const order of ['urborg-first', 'moon-first'] as const) {
    it(`${order}: Urborg and other nonbasics are only Mountains, basics are not Swamps`, () => {
      const { moon, urborg, forest, tower } = make();
      const battlefield = order === 'urborg-first' ? [urborg, forest, tower, moon] : [moon, urborg, forest, tower];
      const state: any = { battlefield, players: [{ id: 'p1' }] };
      expect(getEffectiveBasicLandTypes(state, urborg)).toEqual(['mountain']);
      expect(getEffectiveBasicLandTypes(state, tower)).toEqual(['mountain']);
      expect(getEffectiveBasicLandTypes(state, forest)).toEqual(['forest']);
    });
  }
  it('without Blood Moon, Urborg makes every land a Swamp', () => {
    const { urborg, forest } = make();
    const state: any = { battlefield: [urborg, forest], players: [{ id: 'p1' }] };
    expect(getEffectiveBasicLandTypes(state, forest)).toEqual(['swamp', 'forest']);
  });
});
