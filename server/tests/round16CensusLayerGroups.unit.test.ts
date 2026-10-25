import { it, expect } from 'vitest';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
let n = 0;
const P = (name: string, tl: string, o: string, pt?: [string, string], extra: any = {}) => ({ id: 'x' + (++n), controller: 'p1', owner: 'p1', counters: {}, tapped: false, card: { id: 'c' + n, name, type_line: tl, oracle_text: o, power: pt?.[0], toughness: pt?.[1], mana_cost: extra.mc || '' }, ...extra });
const st = (bf: any[], extra: any = {}) => ({ battlefield: bf, stack: [], players: [{ id: 'p1' }, { id: 'p2' }], life: { p1: 23, p2: 40 }, startingLife: 40, zones: { p1: { graveyard: [{ type_line: 'Instant' }, { type_line: 'Artifact Creature' }], hand: [] }, p2: { graveyard: [{ type_line: 'Land' }], hand: [] } }, turnPlayer: 'p1', ...extra });
const f = (k: string, fn: any) => { const [pw, tg] = k.split(' ')[1].split('/').map(Number); expect(fn(), k).toEqual({ power: pw, toughness: tg }); };
const pt = (c: any, s: any) => { syncDerivedContinuousEffects(s); return getCurrentPowerToughness(c, s); };

import { isCreatureNow, getCreatureTypesNow } from '../src/state/creatureTypeNow';
import { landAwareTypeLine } from '../src/state/modules/effectiveLandTypeLine';
const R: Record<string, any> = {};
const D = (label: string, perm: any, s: any) => { R[label] = { pt: pt(perm, s), creature: isCreatureNow(perm), types: [...getCreatureTypesNow(perm)], line: landAwareTypeLine(s, perm) }; };
it('round 16: land animation, Vehicle Aura, Frogify, domain CDA, conditional attached buffs', () => {
  { const l = P('Forest', 'Basic Land \u2014 Forest', '({T}: Add {G}.)'); const n = P("Nature's Revolt", 'Enchantment', 'All lands are 2/2 creatures that are still lands.'); D('revolt', l, st([l, n])); }
  { const v = P('Smuggler', 'Artifact \u2014 Vehicle', 'Crew 1', ['3', '3']); const a = P('Aerial Modification', 'Enchantment \u2014 Aura', "Enchant creature or Vehicle\nAs long as enchanted permanent is a Vehicle, it's a creature in addition to its other types.\nEnchanted creature gets +2/+2 and has flying.", undefined, { attachedTo: 'x' + (n - 0) }); a.attachedTo = v.id; D('aerial', v, st([v, a])); }
  { const c = P('Dragon', 'Creature \u2014 Dragon', 'Flying', ['5', '5']); const a = P('Frogify', 'Enchantment \u2014 Aura', 'Enchant creature\nEnchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1. (It loses all other card types and creature types.)'); a.attachedTo = c.id; D('frogify', c, st([c, a])); }
  { const fo = P('Forest', 'Basic Land \u2014 Forest', ''); const is = P('Island', 'Basic Land \u2014 Island', ''); const f2 = P('Fblthp, Knows the Way', 'Legendary Creature \u2014 Homunculus', "Domain \u2014 Fblthp's power is equal to the number of basic land types among lands you control.\nWhen Fblthp enters, search your library.", ['*', '2']); D('fblthp', f2, st([fo, is, f2])); }
  { const fo = P('Forest', 'Basic Land \u2014 Forest', ''); const u = P('Urborg, Tomb of Yawgmoth', 'Legendary Land', 'Each land is a Swamp in addition to its other land types.'); D('urborg', fo, st([fo, u])); }
  { const m = P('Mountain', 'Basic Land \u2014 Mountain', ''); const g = P('Goblin Caves', 'Enchantment \u2014 Aura', 'Enchant land\nAs long as enchanted land is a basic Mountain, Goblin creatures get +0/+2.'); g.attachedTo = m.id; const gob = P('Goblin', 'Creature \u2014 Goblin', '', ['1', '1'], { controller: 'p2' }); D('caves', gob, st([m, g, gob])); }
  { const c = P('Merfolk', 'Creature \u2014 Merfolk', '', ['1', '1'], { card2: 1 }); (c.card as any).colors = ['U']; (c.card as any).mana_cost = '{U}'; const h = P('Helm of the Ghastlord', 'Enchantment \u2014 Aura', 'Enchant creature\nAs long as enchanted creature is blue, it gets +1/+1 and has "Whenever this creature deals damage to an opponent, draw a card."\nAs long as enchanted creature is black, it gets +1/+1 and has "Whenever this creature deals damage to an opponent, that player discards a card."'); h.attachedTo = c.id; D('helm', c, st([c, h])); }
  { const c = P('Bear', 'Creature \u2014 Bear', '', ['7', '7']); const t = P('So Tiny', 'Enchantment \u2014 Aura', 'Flash\nEnchant creature\nEnchanted creature gets -2/-0. It gets -6/-0 instead as long as its controller has seven or more cards in their graveyard.'); t.attachedTo = c.id; D('tiny', c, st([c, t])); const gy = Array.from({ length: 7 }, () => ({ type_line: 'Land' })); D('tiny7', c, st([c, t], { zones: { p1: { hand: [], graveyard: gy }, p2: { hand: [], graveyard: [] } } })); }
  { const c = P('Bear', 'Creature \u2014 Bear', '', ['2', '2']); const c2 = P('Bear2', 'Creature \u2014 Bear', '', ['2', '2']); const b = P("Bride's Gown", 'Artifact \u2014 Equipment', "Equipped creature gets +2/+0. It gets an additional +0/+2 and has first strike as long as an Equipment named Groom's Finery is attached to a creature you control.\nEquip {2}"); b.attachedTo = c.id; D('gown', c, st([c, c2, b])); const g = P("Groom's Finery", 'Artifact \u2014 Equipment', 'Equipped creature gets +2/+0.'); g.attachedTo = c2.id; D('gown2', c, st([c, c2, b, g])); }
  { const c = P('Bear', 'Creature \u2014 Bear', '', ['4', '4']); const fd = P('Fear of Death', 'Enchantment \u2014 Aura', 'Enchant creature\nWhen this Aura enters, mill two cards.\nEnchanted creature gets -X/-0, where X is the number of cards in your graveyard.'); fd.attachedTo = c.id; D('fear', c, st([c, fd])); }
  expect(R.revolt.pt).toEqual({ power: 2, toughness: 2 }); expect(R.revolt.creature).toBe(true);
  expect(R.aerial.pt).toEqual({ power: 5, toughness: 5 }); expect(R.aerial.creature).toBe(true);
  expect(R.frogify.pt).toEqual({ power: 1, toughness: 1 }); expect(R.frogify.types.map((t: string) => t.toLowerCase())).toEqual(['frog']);
  expect(R.fblthp.pt).toEqual({ power: 2, toughness: 2 });
  expect(R.urborg.line).toMatch(/swamp/);
  expect(R.caves.pt).toEqual({ power: 1, toughness: 3 });
  expect(R.helm.pt).toEqual({ power: 2, toughness: 2 });
  expect(R.tiny.pt).toEqual({ power: 5, toughness: 7 }); expect(R.tiny7.pt).toEqual({ power: 1, toughness: 7 });
  expect(R.gown.pt).toEqual({ power: 4, toughness: 2 }); expect(R.gown2.pt).toEqual({ power: 4, toughness: 4 });
  expect(R.fear.pt).toEqual({ power: 2, toughness: 4 });
});
