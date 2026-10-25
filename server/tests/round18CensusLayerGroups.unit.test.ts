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
const X = (c: any, s: any, p: number, q: number) => expect(pt(c, s)).toEqual({ power: p, toughness: q });
it('negative anthem: Heartless Summoning hits only its controller', () => {
  const c = P('Bear', C('Bear'), '', ['2', '2']); const o = P('Ogre', C('Ogre'), '', ['3', '3'], { controller: 'p2' });
  const e = P('Census Source', 'Enchantment', 'Creature spells you cast cost {2} less to cast.\nCreatures you control get -1/-1.');
  const s = st([c, o, e]); X(c, s, 1, 1); X(o, s, 3, 3);
});
it('mixed-sign anthem: Flowstone Surge', () => {
  const c = P('Bear', C('Bear'), '', ['2', '2']); X(c, st([c, P('Census Source', 'Enchantment', 'Creatures you control get +1/-1.')]), 3, 1);
});
it('triggered / until-end-of-turn penalty anthems stay non-static', () => {
  const c = P('Bear', C('Bear'), '', ['2', '2']);
  X(c, st([c, P('Census Source', 'Enchantment', 'Whenever you cast a spell, creatures you control get -1/-1 until end of turn.')]), 2, 2);
});
it('per-artifact equipment (Improvised Arsenal / Cranial Plating style)', () => {
  const c = P('Bear', C('Bear'), '', ['2', '2']); const r = P('Rock', 'Artifact', '');
  const e = on(P('Census Source', Q, 'Equipped creature gets +1/+0 for each artifact you control.\nEquip {1}'), c); X(c, st([c, r, e]), 4, 2);
});
it('keyword count base respects lost keywords (Pride of the Clouds)', () => {
  const b = P('Bird', C('Bird'), 'Flying', ['1', '1'], { controller: 'p2' });
  const sw = on(P('Starforged Sword', Q, 'Equipped creature gets +3/+3 and loses flying.\nEquip {3}', undefined, { controller: 'p2' }), b);
  const c = P('Pride of the Clouds', C('Elemental Cat'), 'Flying\nThis creature gets +1/+1 for each other creature on the battlefield with flying.', ['1', '1']);
  X(c, st([b, sw, c]), 1, 1);
  const b2 = P('Bird', C('Bird'), 'Flying', ['1', '1'], { controller: 'p2' }); X(c, st([b2, c]), 2, 2);
});
