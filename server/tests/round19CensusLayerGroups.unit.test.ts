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
it('Blood Moon text works under any name (nonbasic only, all controllers)', () => {
  const { nb, fo, opp, s } = board('Nonbasic lands are Mountains.');
  expect(getEffectiveBasicLandTypes(s, nb)).toEqual(['mountain']);
  expect(getEffectiveBasicLandTypes(s, opp)).toEqual(['mountain']);
  expect(getEffectiveBasicLandTypes(s, fo)).toEqual(['forest']);
  expect(landAwareTypeLine(s, nb)).toContain('mountain');
});
it('Celestial Dawn text sets only your lands, replacing their types', () => {
  const { nb, fo, opp, s } = board('Lands you control are Plains.');
  expect(getEffectiveBasicLandTypes(s, fo)).toEqual(['plains']);
  expect(getEffectiveBasicLandTypes(s, nb)).toEqual(['plains']);
  expect(getEffectiveBasicLandTypes(s, opp)).toEqual([]);
});
it('"in addition" forms stay additive', () => {
  const { fo, s } = board('Each land is a Swamp in addition to its other land types.', 'Land');
  expect(getEffectiveBasicLandTypes(s, fo).sort()).toEqual(['forest', 'swamp']);
});
it('Zendikon: enchanted land becomes an N/N creature that is still a land', () => {
  const { fo, nb, s } = board("Enchant land\nEnchanted land is a 5/3 green Elemental creature. It's still a land.", E, true);
  expect(isCreatureNow(fo, s)).toBe(true); expect(getCurrentPowerToughness(fo, s)).toEqual({ power: 5, toughness: 3 });
  expect(landAwareTypeLine(s, fo)).toContain('land'); expect(isCreatureNow(nb, s)).toBe(false);
});
it('"until end of turn" animation is not a static Zendikon', () => {
  const { fo, s } = board('Enchant land\nEnchanted land is a 2/2 creature until end of turn.', E, true);
  expect(isCreatureNow(fo, s)).toBe(false);
});
