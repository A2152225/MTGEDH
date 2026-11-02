import { it, expect } from 'vitest';
import { syncDerivedContinuousEffects, getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
import { getCreatureTypesNow, isCreatureNow } from '../src/state/creatureTypeNow';
let n = 0;
const P = (name: string, tl: string, o: string, extra: any = {}) => ({ id: 'z' + (++n), controller: 'p1', owner: 'p1', counters: {}, tapped: false, card: { id: 'e' + n, name, type_line: tl, oracle_text: o, power: '1', toughness: '1', colors: [] }, ...extra });
const st = (bf: any[]) => ({ battlefield: bf, stack: [], players: [{ id: 'p1' }, { id: 'p2' }], life: { p1: 40, p2: 40 }, zones: { p1: { graveyard: [], hand: [] }, p2: { graveyard: [], hand: [] } }, turnPlayer: 'p1' });
const ab = (c: any, s: any) => { syncDerivedContinuousEffects(s); return getContinuousGrantedAbilitiesForPermanent(c, s).map((x: string) => x.toLowerCase()); };
const types = (c: any) => [...getCreatureTypesNow(c)].map((t: any) => String(t).toLowerCase());

it('tail verification: Skyknight Squire, Taborax, Pelt Collector, Angelic Cub, Warden of the Inner Sky, Vadmir', () => {
  const sq = P('Skyknight Squire', 'Creature \u2014 Cat Scout', 'Whenever another creature you control enters, put a +1/+1 counter on this creature.\nAs long as this creature has three or more +1/+1 counters on it, it has flying and is a Knight in addition to its other types.', { counters: { '+1/+1': 3 } });
  const tb = P('Taborax, Hope\'s Demise', 'Legendary Creature \u2014 Demon Cleric', 'Flying\nTaborax has lifelink as long as it has five or more +1/+1 counters on it.', { counters: { '+1/+1': 5 } });
  const pc = P('Pelt Collector', 'Creature \u2014 Elf Warrior', 'As long as this creature has three or more +1/+1 counters on it, it has trample.', { counters: { '+1/+1': 2 } });
  const cub = P('Angelic Cub', 'Creature \u2014 Cat Angel', 'As long as this creature has three or more +1/+1 counters on it, it has flying.', { counters: { '+1/+1': 3 } });
  const wd = P('Warden of the Inner Sky', 'Creature \u2014 Human Soldier', 'As long as this creature has three or more counters on it, it has flying and vigilance.', { counters: { '+1/+1': 1, shield: 1, stun: 1 } });
  const vd = P('Vadmir, New Blood', 'Legendary Creature \u2014 Vampire Rogue', 'As long as Vadmir has four or more +1/+1 counters on it, it has menace and lifelink.', { counters: { '+1/+1': 4 } });
  const s = st([sq, tb, pc, cub, wd, vd]);
  expect(ab(sq, s)).toContain('flying'); expect(types(sq)).toContain('knight');
  expect(ab(tb, s)).toContain('lifelink');
  expect(ab(pc, s)).not.toContain('trample'); pc.counters = { '+1/+1': 3 }; expect(ab(pc, s)).toContain('trample');
  expect(ab(cub, s)).toContain('flying');
  const w = ab(wd, s); expect(w).toContain('flying'); expect(w).toContain('vigilance');
  const v = ab(vd, s); expect(v).toContain('menace'); expect(v).toContain('lifelink');
});
it('counter threshold makes a Vehicle a creature (War Balloon) without polluting creature types', () => {
  const wb = P('War Balloon', 'Artifact \u2014 Vehicle', 'Flying\n{1}: Put a fire counter on this Vehicle.\nAs long as this Vehicle has three or more fire counters on it, it\'s an artifact creature.', { counters: { fire: 2 } });
  wb.card.power = '4'; wb.card.toughness = '3';
  const s = st([wb]);
  syncDerivedContinuousEffects(s); expect(isCreatureNow(wb)).toBe(false);
  wb.counters = { fire: 3 }; syncDerivedContinuousEffects(s);
  expect(isCreatureNow(wb)).toBe(true);
  expect(types(wb)).not.toContain('creature'); expect(types(wb)).not.toContain('artifact');
});
it('counter threshold adds a creature type and creature-ness (Weatherlight Compleated)', () => {
  const w = P('Weatherlight Compleated', 'Legendary Artifact \u2014 Vehicle', 'Flying\nAs long as Weatherlight Compleated has four or more phyresis counters on it, it\'s a Phyrexian creature in addition to its other types.', { counters: { phyresis: 4 } });
  const s = st([w]); syncDerivedContinuousEffects(s);
  expect(isCreatureNow(w)).toBe(true); expect(types(w)).toContain('phyrexian');
});
it('enchanted by exactly N / N or more Auras sets base P/T and keywords (Timber Paladin)', () => {
  const o = 'As long as this creature is enchanted by exactly one Aura, it has base power and toughness 3/3.\nAs long as this creature is enchanted by exactly two Auras, it has base power and toughness 5/5 and vigilance.\nAs long as this creature is enchanted by three or more Auras, it has base power and toughness 10/10, vigilance, and trample.';
  const tp = P('Timber Paladin', 'Artifact Creature \u2014 Knight', o);
  const aura = (i: number) => ({ ...P('Aura ' + i, 'Enchantment \u2014 Aura', ''), attachedTo: tp.id });
  const eq = { ...P('Census Rig', 'Artifact \u2014 Equipment', ''), attachedTo: tp.id };
  const s: any = st([tp, eq]);
  syncDerivedContinuousEffects(s); expect(getCurrentPowerToughness(tp, s)).toEqual({ power: 1, toughness: 1 });
  s.battlefield.push(aura(1)); syncDerivedContinuousEffects(s); expect(getCurrentPowerToughness(tp, s)).toEqual({ power: 3, toughness: 3 });
  s.battlefield.push(aura(2)); expect(ab(tp, s)).toContain('vigilance'); expect(getCurrentPowerToughness(tp, s)).toEqual({ power: 5, toughness: 5 });
  expect(ab(tp, s)).not.toContain('trample');
  s.battlefield.push(aura(3), aura(4)); const a = ab(tp, s); expect(a).toContain('trample'); expect(a).toContain('vigilance');
  expect(getCurrentPowerToughness(tp, s)).toEqual({ power: 10, toughness: 10 });
});

it('opponent life / opponent board / typed graveyard conditions (Guul Draz Vampire, Erebos\'s Titan, Vexing Beetle, Murasa Behemoth)', () => {
  const gd = P('Guul Draz Vampire', 'Creature \u2014 Vampire Rogue', 'As long as an opponent has 10 or less life, this creature gets +2/+1 and has intimidate.');
  const et = P('Erebos\'s Titan', 'Creature \u2014 Giant', 'As long as your opponents control no creatures, this creature has indestructible.');
  const vb = P('Vexing Beetle', 'Creature \u2014 Insect', 'This creature gets +3/+3 as long as no opponent controls a creature.');
  const mb = P('Murasa Behemoth', 'Creature \u2014 Beast', 'Trample\nThis creature gets +3/+3 as long as there is a land card in your graveyard.');
  const s: any = st([gd, et, vb, mb]);
  expect(ab(gd, s)).not.toContain('intimidate'); expect(ab(et, s)).toContain('indestructible');
  expect(getCurrentPowerToughness(vb, s)).toEqual({ power: 4, toughness: 4 });
  expect(getCurrentPowerToughness(mb, s)).toEqual({ power: 1, toughness: 1 });
  s.life.p2 = 10; s.zones.p1.graveyard.push({ name: 'Forest', type_line: 'Basic Land \u2014 Forest' });
  s.battlefield.push({ ...P('Foe', 'Creature \u2014 Goblin', ''), controller: 'p2', owner: 'p2' });
  expect(ab(gd, s)).toContain('intimidate'); expect(getCurrentPowerToughness(gd, s)).toEqual({ power: 3, toughness: 2 });
  expect(ab(et, s)).not.toContain('indestructible');
  expect(getCurrentPowerToughness(vb, s)).toEqual({ power: 1, toughness: 1 });
  expect(getCurrentPowerToughness(mb, s)).toEqual({ power: 4, toughness: 4 });
});
