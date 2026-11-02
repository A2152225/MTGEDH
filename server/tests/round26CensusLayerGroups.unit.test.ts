import { it, expect } from 'vitest';
import { syncDerivedContinuousEffects, getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
let n = 0;
const P = (name: string, tl: string, o: string, extra: any = {}) => ({ id: 'y' + (++n), controller: 'p1', owner: 'p1', counters: {}, tapped: false, card: { id: 'f' + n, name, type_line: tl, oracle_text: o, power: '1', toughness: '1', colors: [] }, ...extra });
const st = (bf: any[]): any => ({ battlefield: bf, stack: [], startingLife: 40, players: [{ id: 'p1' }, { id: 'p2' }], life: { p1: 40, p2: 40 }, poisonCounters: {}, zones: { p1: { graveyard: [], hand: [], libraryCount: 60 }, p2: { graveyard: [], hand: [], libraryCount: 60 } }, turnPlayer: 'p1' });
const ab = (c: any, s: any) => { syncDerivedContinuousEffects(s); return getContinuousGrantedAbilitiesForPermanent(c, s).map((x: string) => x.toLowerCase()); };
const pt = (c: any, s: any) => { syncDerivedContinuousEffects(s); return getCurrentPowerToughness(c, s); };

it('has defender as long as it is a Wall (Mistform Wall)', () => {
  const w = P('Census Mist', 'Creature \u2014 Illusion Wall', 'This creature has defender as long as it\u2019s a Wall.');
  const s = st([w]);
  expect(ab(w, s)).toContain('defender');
  w.card.type_line = 'Creature \u2014 Illusion Bird';
  expect(ab(w, s)).not.toContain('defender');
});
it('as long as a library has twenty or fewer cards (Isleback Spawn)', () => {
  const k = P('Census Kraken', 'Creature \u2014 Kraken', 'This creature gets +4/+8 as long as a library has twenty or fewer cards in it.');
  const s = st([k]);
  expect(pt(k, s)).toEqual({ power: 1, toughness: 1 });
  s.zones.p2.libraryCount = 20;
  expect(pt(k, s)).toEqual({ power: 5, toughness: 9 });
});
it('less than half starting life: count and condition (Anya)', () => {
  const a = P('Census Angel', 'Legendary Creature \u2014 Angel', 'Flying\nCensus Angel gets +3/+3 for each opponent whose life total is less than half their starting life total.\nAs long as an opponent\u2019s life total is less than half their starting life total, Census Angel has indestructible.');
  const s = st([a]); s.players.push({ id: 'p3' }); s.life.p3 = 40;
  expect(pt(a, s)).toEqual({ power: 1, toughness: 1 }); expect(ab(a, s)).not.toContain('indestructible');
  s.life.p2 = 20; expect(pt(a, s)).toEqual({ power: 1, toughness: 1 });
  s.life.p2 = 19; s.life.p3 = 5;
  expect(pt(a, s)).toEqual({ power: 7, toughness: 7 }); expect(ab(a, s)).toContain('indestructible');
});
it('for each transformed permanent you control (Mutagen Connoisseur)', () => {
  const m = P('Census Mutant', 'Creature \u2014 Vedalken Mutant', 'This creature gets +1/+0 for each transformed permanent you control.');
  const s = st([m, P('Census Flip', 'Creature \u2014 Werewolf', '', { transformed: true }), P('Census Flop', 'Creature \u2014 Human', ''), P('Census Foe Flip', 'Creature \u2014 Werewolf', '', { transformed: true, controller: 'p2', owner: 'p2' })]);
  expect(pt(m, s)).toEqual({ power: 2, toughness: 1 });
});
it('as long as you control exactly one creature (Deadly Wanderings)', () => {
  const e = P('Census Wander', 'Enchantment', 'As long as you control exactly one creature, that creature gets +2/+0 and has deathtouch and lifelink.');
  const c = P('Census Lone', 'Creature \u2014 Human', '');
  const s = st([e, c]);
  expect(pt(c, s)).toEqual({ power: 3, toughness: 1 }); expect(ab(c, s)).toEqual(expect.arrayContaining(['deathtouch', 'lifelink']));
  s.battlefield.push(P('Census Pal', 'Creature \u2014 Elf', ''));
  expect(pt(c, s)).toEqual({ power: 1, toughness: 1 }); expect(ab(c, s)).not.toContain('deathtouch');
});
it('opponent poison threshold grants lifelink to toxic creatures (Skrelv\'s Hive)', () => {
  const h = P('Census Hive', 'Enchantment', 'Corrupted \u2014 As long as an opponent has three or more poison counters, creatures you control with toxic have lifelink.');
  const mite = P('Census Mite', 'Token Artifact Creature \u2014 Phyrexian Mite', 'Toxic 1 (Players dealt combat damage by this creature also get a poison counter.)', { isToken: true });
  const bear = P('Census Bear', 'Creature \u2014 Bear', '');
  const s = st([h, mite, bear]);
  expect(ab(mite, s)).not.toContain('lifelink');
  s.poisonCounters.p2 = 3;
  expect(ab(mite, s)).toContain('lifelink'); expect(ab(bear, s)).not.toContain('lifelink');
});
