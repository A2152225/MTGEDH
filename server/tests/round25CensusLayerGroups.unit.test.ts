import { it, expect } from 'vitest';
import { syncDerivedContinuousEffects, getContinuousGrantedAbilitiesForPermanent, readDerivedStaticEffectSpecs } from '../src/state/modules/staticEffectSpec';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
import { isCreatureNow } from '../src/state/creatureTypeNow';
let n = 0;
const P = (name: string, tl: string, o: string, extra: any = {}) => ({ id: 'z' + (++n), controller: 'p1', owner: 'p1', counters: {}, tapped: false, card: { id: 'e' + n, name, type_line: tl, oracle_text: o, power: '1', toughness: '1', colors: [] }, ...extra });
const st = (bf: any[]) => ({ battlefield: bf, stack: [], players: [{ id: 'p1' }, { id: 'p2' }], life: { p1: 40, p2: 40 }, zones: { p1: { graveyard: [], hand: [] }, p2: { graveyard: [], hand: [] } }, turnPlayer: 'p1' });
const ab = (c: any, s: any) => { syncDerivedContinuousEffects(s); return getContinuousGrantedAbilitiesForPermanent(c, s).map((x: string) => x.toLowerCase()); };

const pt = (c: any, s: any) => { syncDerivedContinuousEffects(s); return getCurrentPowerToughness(c, s); };

it('typed and conditional token groups you control (Eternal Skylord, Starry-Eyed Skyrider, Great Goblin Armies)', () => {
  const sky = P('Eternal Skylord', 'Creature \u2014 Zombie Wizard', 'When this creature enters, amass Zombies 2.\nZombie tokens you control have flying.');
  const zt = P('Zombie Army', 'Token Creature \u2014 Zombie Army', '', { isToken: true });
  const zc = P('Gravecrawler', 'Creature \u2014 Zombie', '');
  const rider = P('Starry-Eyed Skyrider', 'Creature \u2014 Human Scout', 'Flying\nAttacking tokens you control have flying.');
  const tok = P('Soldier', 'Token Creature \u2014 Soldier', '', { isToken: true });
  const gob = P('Great Goblin, Foul-Hearted', 'Legendary Creature \u2014 Goblin Noble', 'Armies you control have trample.');
  const army = P('Goblin Army', 'Token Creature \u2014 Goblin Army', '', { isToken: true });
  const foeArmy = P('Orc Army', 'Token Creature \u2014 Orc Army', '', { isToken: true, controller: 'p2', owner: 'p2' });
  const s = st([sky, zt, zc, rider, tok, gob, army, foeArmy]);
  expect(ab(zt, s)).toContain('flying'); expect(ab(zc, s)).not.toContain('flying');
  expect(ab(tok, s)).not.toContain('flying'); (tok as any).attacking = 'p2'; expect(ab(tok, s)).toContain('flying');
  expect(ab(army, s)).toContain('trample'); expect(ab(foeArmy, s)).not.toContain('trample'); expect(ab(gob, s)).not.toContain('trample');
});
it('global typed lord (Soraya) and creatures with / without flying (Gravitational Shift)', () => {
  const so = P('Soraya the Falconer', 'Legendary Creature \u2014 Human', 'Bird creatures get +1/+1.');
  const bird = P('Birds of Paradise', 'Creature \u2014 Bird', 'Flying', { controller: 'p2', owner: 'p2' });
  const bear = P('Grizzly Bears', 'Creature \u2014 Bear', '');
  const gs = P('Gravitational Shift', 'Enchantment', 'Creatures with flying get +2/+0.\nCreatures without flying get -2/-0.');
  const s = st([so, bird, bear, gs]);
  expect(pt(bird, s)).toEqual({ power: 4, toughness: 2 });
  expect(pt(bear, s)).toEqual({ power: -1, toughness: 1 });
  expect(pt(so, s)).toEqual({ power: -1, toughness: 1 });
});
it('for each <qualified> permanent you control (Benalish Honor Guard)', () => {
  const g = P('Benalish Honor Guard', 'Creature \u2014 Human Knight', 'This creature gets +1/+0 for each legendary creature you control.');
  const s = st([g, P('Grizzly Bears', 'Creature \u2014 Bear', '')]);
  expect(pt(g, s)).toEqual({ power: 1, toughness: 1 });
  s.battlefield.push(P('Isamaru', 'Legendary Creature \u2014 Dog', ''), P('Kiki', 'Legendary Creature \u2014 Goblin', ''), P('Foe Legend', 'Legendary Creature \u2014 Elf', '', { controller: 'p2', owner: 'p2' }));
  expect(pt(g, s)).toEqual({ power: 3, toughness: 1 });
});
it('enchanted / equipped creature loses a keyword (Grounded)', () => {
  const host = P('Serra Angel', 'Creature \u2014 Angel', 'Flying\nVigilance');
  const aura = P('Grounded', 'Enchantment \u2014 Aura', 'Enchant creature\nEnchanted creature loses flying.', { attachedTo: host.id });
  const s = st([host, aura]);
  syncDerivedContinuousEffects(s);
  const specs = (readDerivedStaticEffectSpecs(s) || []) as any[];
  const removed = specs.filter((x) => String(x.sourcePermanentId) === host.id && (x.grant?.removeAbilities || []).includes('flying'));
  expect(removed.length).toBe(1);
});
it('max speed P/T rider applies only at speed 4 (Walking Sarcophagus)', () => {
  const w = P('Walking Sarcophagus', 'Artifact Creature \u2014 Zombie Cat', 'Start your engines!\nMax speed \u2014 This creature gets +1/+2.');
  w.card.power = '2'; w.card.toughness = '1';
  const s: any = st([w]); s.speed = { p1: 3 };
  expect(pt(w, s)).toEqual({ power: 2, toughness: 1 });
  s.speed = { p1: 4 }; expect(pt(w, s)).toEqual({ power: 3, toughness: 3 });
});
it('aura makes an enchanted Vehicle a creature (Aerial Modification)', () => {
  const v = P('Smuggler\'s Copter', 'Artifact \u2014 Vehicle', 'Flying');
  v.card.power = '3'; v.card.toughness = '3';
  const aura = P('Aerial Modification', 'Enchantment \u2014 Aura', 'Enchant creature or Vehicle\nAs long as enchanted permanent is a Vehicle, it\'s a creature in addition to its other types.\nEnchanted creature gets +2/+2 and has flying.', { attachedTo: v.id });
  const s = st([v]); syncDerivedContinuousEffects(s); expect(isCreatureNow(v)).toBe(false);
  s.battlefield.push(aura); syncDerivedContinuousEffects(s); expect(isCreatureNow(v)).toBe(true);
});
it('equipped creature gets +1/+1 for each artifact and/or enchantment you control (Nettlecyst)', () => {
  const germ = P('Germ', 'Token Creature \u2014 Phyrexian Germ', '', { isToken: true }); germ.card.power = '0'; germ.card.toughness = '0';
  const eq = P('Nettlecyst', 'Artifact \u2014 Equipment', 'Living weapon\nEquipped creature gets +1/+1 for each artifact and/or enchantment you control.\nEquip {2}', { attachedTo: germ.id });
  const s = st([germ, eq, P('Census Charm', 'Enchantment', ''), P('Sol Ring', 'Artifact', ''), P('Foe Ring', 'Artifact', '', { controller: 'p2', owner: 'p2' })]);
  expect(pt(germ, s)).toEqual({ power: 3, toughness: 3 });
});
