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

it('round 17: Frogify sets the colour exactly (layer 5 replacement)', () => {
  const c = P('Dragon', 'Creature \u2014 Dragon', 'Flying', ['5', '5']);
  (c.card as any).colors = ['R'];
  const a = P('Frogify', 'Enchantment \u2014 Aura', 'Enchant creature\nEnchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1. (It loses all other card types and creature types.)');
  a.attachedTo = c.id;
  const h = P('Helm of the Ghastlord', 'Enchantment \u2014 Aura', 'Enchant creature\nAs long as enchanted creature is blue, it gets +1/+1 and has "Whenever this creature deals damage to an opponent, draw a card."\nAs long as enchanted creature is red, it gets +1/+1 and has "Whenever this creature deals damage to an opponent, that player discards a card."');
  h.attachedTo = c.id;
  const s = st([c, a, h]);
  const p = pt(c, s);
  expect(getEffectiveColors(c as any, s)).toEqual(['U']);
  expect(p).toEqual({ power: 2, toughness: 2 });
});

const E = 'Enchantment \u2014 Aura', Q = 'Artifact \u2014 Equipment', C = (t: string) => 'Creature \u2014 ' + t;
const on = (a: any, h: any) => { a.attachedTo = h.id; return a; };

it('round 17: new count bases (player counters, keyword creatures, subtypes you control)', () => {
  { const c = P('Kelsien', C('Human'), 'This creature gets +1/+1 for each experience counter you have.', ['1', '1']);
    f('kelsien 4/4', () => pt(c, st([c], { players: [{ id: 'p1', counters: { experience: 3 } }, { id: 'p2' }] }))); }
  { const v = P('Vishgraz', C('Phyrexian'), 'This creature gets +1/+1 for each poison counter your opponents have.', ['3', '3']);
    f('vishgraz 5/5', () => pt(v, st([v], { poisonCounters: { p1: 4, p2: 2 } }))); }
  { const o = P('Bird', C('Bird'), 'Flying', ['1', '1'], { controller: 'p2' }); const g = P('Bear', C('Bear'), '', ['2', '2'], { controller: 'p2' });
    const c = P('Pride of the Clouds', C('Elemental Cat'), 'Flying\nThis creature gets +1/+1 for each other creature on the battlefield with flying.', ['1', '1']);
    f('pride 2/2', () => pt(c, st([o, g, c]))); }
  { const r = P('Rat', C('Rat'), '', ['1', '1']); const pirate = P('Pirate', C('Human Pirate'), '', ['1', '1']);
    const c = P('Persistent Marshstalker', C('Zombie Rat'), 'This creature gets +1/+0 for each other Rat you control.', ['3', '1']);
    f('marsh 4/1', () => pt(c, st([r, pirate, c]))); }
  { const q = P('Sword', Q, ''); const c = P('Adelbert Steiner', C('Human Knight'), 'Lifelink\nAdelbert Steiner gets +1/+1 for each Equipment you control.', ['2', '1']);
    f('adelbert 3/2', () => pt(c, st([q, c]))); }
});

it('round 17: "as long as any player controls a <color> permanent" (Knight of Grace)', () => {
  const c = P('Knight of Grace', C('Human Knight'), 'This creature gets +1/+0 as long as any player controls a black permanent.', ['2', '2']);
  f('noblack 2/2', () => pt(c, st([c])));
  const b = P('Raven', C('Bird'), '', ['1', '1'], { controller: 'p2' }); (b.card as any).colors = ['B'];
  f('black 3/2', () => pt(c, st([b, c])));
});

it('round 17: toughness-only CDAs (land count, devotion)', () => {
  { const a = P('Forest', 'Basic Land \u2014 Forest', ''); const b = P('Forest', 'Basic Land \u2014 Forest', '');
    const c = P('People of the Woods', C('Human'), "People of the Woods's toughness is equal to the number of Forests you control.", ['1', '*']);
    f('people 1/2', () => pt(c, st([a, b, c]))); }
  { const k = P('Knight', C('Knight'), '', ['2', '2'], { mc: '{1}{B/G}' });
    const c = P('Tymaret, Chosen from Death', C('Zombie'), "Tymaret's toughness is equal to your devotion to black.", ['2', '*'], { mc: '{B}{B}' });
    f('tymaret 2/3', () => pt(c, st([k, c]))); }
});

it('round 17: attached extras riding legacy P/T (loses flying, every creature type) and chosen-type lords', () => {
  { const c = P('Bird', C('Bird'), 'Flying', ['1', '1']); const e = on(P('Starforged Sword', Q, 'Equipped creature gets +3/+3 and loses flying.\nEquip {3}'), c);
    const s = st([c, e]); f('starforged 4/4', () => pt(c, s)); expect(parseCreatureKeywords(c.card, c, s).flying).toBe(false); }
  { const c = P('Bear', C('Bear'), '', ['2', '2']); const e = on(P('Runed Stalactite', Q, 'Equipped creature gets +1/+1 and is every creature type.\nEquip {2}'), c);
    const s = st([c, e]); f('stalactite 3/3', () => pt(c, s)); expect(permanentHasCreatureTypeNow(c, 'Goblin')).toBe(true); }
  { const c = P('Bear', C('Bear'), '', ['2', '2']); const o = P('Ogre', C('Ogre'), '', ['2', '2'], { controller: 'p2' });
    const e = P('Arcane Adaptation', 'Enchantment', 'As this enchantment enters, choose a creature type.\nCreatures you control are the chosen type in addition to their other types. The same is true for creature spells you control and creature cards you own that aren\'t on the battlefield.', undefined, { chosenCreatureType: 'Elf' });
    pt(c, st([c, o, e])); expect(getCreatureTypesNow(c).has('elf')).toBe(true); expect(getCreatureTypesNow(o).has('elf')).toBe(false); }
});
