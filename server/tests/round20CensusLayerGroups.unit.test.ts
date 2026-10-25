import { it, expect } from 'vitest';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
let n = 0;
const P = (name: string, tl: string, o: string, pt?: [string, string], extra: any = {}) => ({ id: 'x' + (++n), controller: 'p1', owner: 'p1', counters: {}, tapped: false, card: { id: 'c' + n, name, type_line: tl, oracle_text: o, power: pt?.[0], toughness: pt?.[1], mana_cost: extra.mc || '' }, ...extra });
const st = (bf: any[], extra: any = {}) => ({ battlefield: bf, stack: [], players: [{ id: 'p1' }, { id: 'p2' }], life: { p1: 23, p2: 40 }, startingLife: 40, zones: { p1: { graveyard: [{ type_line: 'Instant' }, { type_line: 'Artifact Creature' }], hand: [] }, p2: { graveyard: [{ type_line: 'Land' }], hand: [] } }, turnPlayer: 'p1', ...extra });
const f = (k: string, fn: any) => { const [pw, tg] = k.split(' ')[1].split('/').map(Number); expect(fn(), k).toEqual({ power: pw, toughness: tg }); };
const pt = (c: any, s: any) => { syncDerivedContinuousEffects(s); return getCurrentPowerToughness(c, s); };

import { isCreatureNow, getCreatureTypesNow, permanentHasCreatureTypeNow } from '../src/state/creatureTypeNow';
import { parseCreatureKeywords } from '../src/state/modules/combat-mechanics';
import { landAwareTypeLine } from '../src/state/modules/effectiveLandTypeLine';

import { getEffectiveColors } from '../src/state/modules/effectiveColors';

const E = 'Enchantment \u2014 Aura', Q = 'Artifact \u2014 Equipment', C = (t: string) => 'Creature \u2014 ' + t;
const on = (a: any, h: any) => { a.attachedTo = h.id; return a; };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const D = (l: string, c: any, s: any) => { let r: any; try { r = pt(c, s); } catch (e) { r = String(e); } console.log('PROBE', l, JSON.stringify(r)); };

import { getEffectiveBasicLandTypes } from '../src/state/modules/mana-abilities-handlers/manaAbilityLandTypeModifiers';
const board = (o: string, tl = 'Enchantment', attach = false) => {
  const nb = P('Nonbasic', 'Land', '{T}: Add {C}.'); const fo = P('Forest', 'Basic Land \u2014 Forest', ''); const opp = P('Opp Land', 'Land', '', undefined, { controller: 'p2' });
  const src = P('Census Source', tl, o); if (attach) src.attachedTo = fo.id;
  const s = st([nb, fo, opp, src]); syncDerivedContinuousEffects(s); return { nb, fo, opp, s };
};
import { getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec';
import { permanentLostPrintedActivatedAbility } from '../src/state/modules/staticEffectSpecActivationLocks';
import { permanentLosesAllAbilities } from '../../rules-engine/src/permanentKeywordAbilities';
const mtn = () => P('Mountain', 'Basic Land \u2014 Mountain', '');
it('Zendikon sets colour, adds Elemental and grants keywords to the land creature', () => {
  const { fo, s } = board("Enchant land\nEnchanted land is a 1/1 green Elemental creature with reach and haste. It's still a land.", E, true);
  expect(isCreatureNow(fo, s)).toBe(true);
  expect(getEffectiveColors(fo, s)).toEqual(['G']);
  expect([...getCreatureTypesNow(fo)].map((x) => x.toLowerCase())).toContain('elemental');
  const ab = getContinuousGrantedAbilitiesForPermanent(fo, s).map((x: string) => x.toLowerCase());
  expect(ab).toContain('reach'); expect(ab).toContain('haste');
});
it('Ashaya: your nontoken creatures show Forest land types', () => {
  const bear = P('Bear', C('Bear'), '', ['2', '2']); const tok = P('Tok', C('Bear'), '', ['1', '1'], { isToken: true });
  const s = st([bear, tok, P('Census Source', C('Avatar'), 'Nontoken creatures you control are Forest lands in addition to their other types.', ['3', '3'])]);
  syncDerivedContinuousEffects(s);
  expect(landAwareTypeLine(s, bear)).toBe('creature land \u2014 bear forest');
  expect(landAwareTypeLine(s, tok)).toBe('creature \u2014 bear');
});
it('Glittering Frost: enchanted land is snow', () => {
  const { fo, nb, s } = board('Enchant land\nEnchanted land is snow.', E, true);
  expect(landAwareTypeLine(s, fo)).toMatch(/^snow basic land/); expect(landAwareTypeLine(s, nb)).not.toMatch(/snow/);
});
it('Conversion: all Mountains are Plains (any controller, Mountains only)', () => {
  const m1 = mtn(); const m2 = { ...mtn(), id: 'm2', controller: 'p2' }; const fo = P('Forest', 'Basic Land \u2014 Forest', '');
  const s = st([m1, m2, fo, P('Census Source', 'Enchantment', 'At the beginning of your upkeep, sacrifice this enchantment unless you pay {W}{W}.\nAll Mountains are Plains.')]);
  expect(getEffectiveBasicLandTypes(s, m1)).toEqual(['plains']); expect(getEffectiveBasicLandTypes(s, m2)).toEqual(['plains']);
  expect(getEffectiveBasicLandTypes(s, fo)).toEqual(['forest']);
});
it('Illusionary Terrain uses the two chosen types on basic lands only', () => {
  const m1 = mtn(); const nbm = P('Nonbasic Mountain', 'Land \u2014 Mountain', '');
  const src = P('Census Source', 'Enchantment', 'Cumulative upkeep {2}\nAs this enchantment enters, choose two basic land types.\nBasic lands of the first chosen type are the second chosen type.', undefined, { chosenLandTypes: ['Mountain', 'Island'] });
  const s = st([m1, nbm, src]);
  expect(getEffectiveBasicLandTypes(s, m1)).toEqual(['island']); expect(getEffectiveBasicLandTypes(s, nbm)).toEqual(['mountain']);
});
it('Omo: lands with an everything counter are every basic land type', () => {
  const a = mtn(); a.counters = { everything: 1 }; const b = mtn();
  const s = st([a, b, P('Census Source', C('Shapeshifter'), 'Each land with an everything counter on it is every land type in addition to its other types.', ['2', '1'])]);
  expect(getEffectiveBasicLandTypes(s, a)).toEqual(['plains', 'island', 'swamp', 'mountain', 'forest']);
  expect(getEffectiveBasicLandTypes(s, b)).toEqual(['mountain']);
});
it('Blood Sun: lands lose non-mana abilities but keep mana abilities', () => {
  const land = P('Den', 'Land', '{T}: Add {C}.\n{2}, {T}: Draw a card.'); const art = P('Rock', 'Artifact', '{2}, {T}: Draw a card.');
  const s = st([land, art, P('Census Source', 'Enchantment', 'When this enchantment enters, draw a card.\nAll lands lose all abilities except mana abilities.')]);
  expect(permanentLostPrintedActivatedAbility(land as any, s, '{2}, {T}: Draw a card.')).toBe(true);
  expect(permanentLostPrintedActivatedAbility(land as any, s, '{T}: Add {C}.')).toBe(false);
  expect(permanentLostPrintedActivatedAbility(art as any, s, '{2}, {T}: Draw a card.')).toBe(false);
  expect(permanentLosesAllAbilities(land, s.battlefield)).toBe(false);
});
