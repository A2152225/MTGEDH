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
import { permanentCantHaveCountersPut, filterRestrictedCounterDeltas, bannedCounterKinds } from '../src/state/modules/counterPlacementRestrictions';
import { parseCopyEntryExceptions, applyCopyEntryExceptions } from '../src/state/modules/copyEntryExceptions';
const ab = (c: any, s: any) => { syncDerivedContinuousEffects(s); return getContinuousGrantedAbilitiesForPermanent(c, s).map((x: string) => x.toLowerCase()); };
it("can't have counters put on it: self and enchanted, removal still allowed", () => {
  const k = P("Melira's Keepers", C('Phyrexian Warrior'), "This creature can't have counters put on it.", ['4', '4']);
  const b = P('Bear', C('Bear'), '', ['2', '2']); const o = P('Bear 2', C('Bear'), '', ['2', '2']);
  const aura = on(P('Census Source', E, "Enchant creature\nEnchanted creature doesn't untap during its controller's untap step and can't have counters put on it."), b);
  const s = st([k, b, o, aura]);
  expect(permanentCantHaveCountersPut(s, k)).toBe(true); expect(permanentCantHaveCountersPut(s, b)).toBe(true); expect(permanentCantHaveCountersPut(s, o)).toBe(false);
  expect(filterRestrictedCounterDeltas(s, k, { '+1/+1': 2, '-1/-1': -1 })).toEqual({ '-1/-1': -1 });
});
it('ward for creatures you control with a counter keeps its cost and needs a counter', () => {
  const a = P('A', C('Bear'), '', ['2', '2'], { counters: { '+1/+1': 1 } }); const b = P('B', C('Bear'), '', ['2', '2']);
  const opp = P('O', C('Bear'), '', ['2', '2'], { controller: 'p2', counters: { '+1/+1': 1 } });
  const s = st([a, b, opp, P('Census Source', C('Human Cleric'), 'Each creature you control with a counter on it has ward {1}.', ['1', '4'])]);
  expect(ab(a, s)).toContain('ward {1}'); expect(ab(b, s)).not.toContain('ward {1}'); expect(ab(opp, s)).not.toContain('ward {1}');
});
it('other creatures with a +1/+1 counter have haste (Exava), not the source', () => {
  const a = P('A', C('Bear'), '', ['2', '2'], { counters: { '+1/+1': 1 } });
  const src = P('Census Source', C('Vampire'), 'Each other creature you control with a +1/+1 counter on it has haste.', ['2', '2'], { counters: { '+1/+1': 1 } });
  const s = st([a, src]);
  expect(ab(a, s)).toContain('haste'); expect(ab(src, s)).not.toContain('haste');
});
it('Cathedral of Serra: white legendary creatures you control get the quoted grant', () => {
  const w = P('W', 'Legendary ' + C('Human'), '', ['2', '2'], { card: { id: 'cw', name: 'W', type_line: 'Legendary Creature \u2014 Human', oracle_text: '', power: '2', toughness: '2', colors: ['W'] } });
  const nl = P('N', C('Human'), '', ['2', '2'], { card: { id: 'cn', name: 'N', type_line: 'Creature \u2014 Human', oracle_text: '', power: '2', toughness: '2', colors: ['W'] } });
  const s = st([w, nl, P('Census Source', 'Land', 'White legendary creatures you control have "bands with other legendary creatures."')]);
  expect(ab(w, s).join('|')).toMatch(/bands with other legendary creatures/); expect(ab(nl, s).join('|')).not.toMatch(/bands with other/);
});
it('copy-with-exception: quoted abilities, keywords, conditional vanishing, own other abilities', () => {
  const gig = parseCopyEntryExceptions('You may have this creature enter as a copy of any creature on the battlefield, except it has "{X}: This creature has base power and toughness X/X."');
  expect(gig?.abilities).toEqual(['{X}: This creature has base power and toughness X/X.']);
  expect(parseCopyEntryExceptions("You may have this creature enter as a copy of any creature on the battlefield, except it has haste and dethrone.")?.abilities).toEqual(['Haste', 'Dethrone']);
  const flesh = "You may have this creature enter as a copy of any creature on the battlefield, except it has vanishing 3 if that creature doesn't have vanishing.";
  const c1: any = { card: { type_line: 'Creature \u2014 Bear', oracle_text: 'Trample' } }; applyCopyEntryExceptions(c1, flesh);
  expect(c1.card.oracle_text).toMatch(/Vanishing 3/i);
  const c2: any = { card: { type_line: 'Creature \u2014 Bear', oracle_text: 'Vanishing 2' } }; applyCopyEntryExceptions(c2, flesh);
  expect(c2.card.oracle_text).not.toMatch(/Vanishing 3/i);
  const saka = "You may have Sakashima enter as a copy of another creature you control, except it has Sakashima's other abilities.\nThe \"legend rule\" doesn't apply to permanents you control.";
  const c3: any = { card: { type_line: 'Legendary Creature \u2014 Elf', oracle_text: 'Flying' } }; applyCopyEntryExceptions(c3, saka);
  expect(c3.card.oracle_text).toMatch(/legend rule/); expect(c3.card.oracle_text).not.toMatch(/as a copy of/);
});
it('has flying as long as it is enchanted / modified (self state)', () => {
  const os = P('Fledgling Osprey', C('Bird'), "Fledgling Osprey has flying as long as it's enchanted.", ['1', '1']);
  const sp = P('Skyward Spider', C('Phyrexian Spider'), "Ward {2}\nThis creature has flying as long as it's modified.", ['2', '2']);
  const s = st([os, sp]);
  expect(ab(os, s)).not.toContain('flying'); expect(ab(sp, s)).not.toContain('flying');
  s.battlefield.push(on(P('Aura', E, 'Enchant creature'), os)); sp.counters = { '+1/+1': 1 };
  expect(ab(os, s)).toContain('flying'); expect(ab(sp, s)).toContain('flying');
});
it("Melira: creatures you control can't have -1/-1 counters put on them", () => {
  const b = P('Bear', C('Bear'), '', ['2', '2']); const o = P('Opp', C('Bear'), '', ['2', '2'], { controller: 'p2' });
  const s = st([b, o, P('Census Source', C('Human Wizard'), "You can't get poison counters.\nCreatures you control can't have -1/-1 counters put on them.\nCreatures your opponents control lose infect.", ['2', '2'])]);
  expect(bannedCounterKinds(s, b)).toEqual(['-1/-1']); expect(bannedCounterKinds(s, o)).toEqual([]);
  expect(filterRestrictedCounterDeltas(s, b, { '-1/-1': 2, '+1/+1': 1 })).toEqual({ '+1/+1': 1 });
  expect(filterRestrictedCounterDeltas(s, o, { '-1/-1': 2 })).toEqual({ '-1/-1': 2 });
});
