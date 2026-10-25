import { it, expect } from 'vitest';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
let n = 0;
const P = (name: string, tl: string, o: string, pt?: [string, string], extra: any = {}) => ({ id: 'x' + (++n), controller: 'p1', owner: 'p1', counters: {}, tapped: false, card: { id: 'c' + n, name, type_line: tl, oracle_text: o, power: pt?.[0], toughness: pt?.[1], mana_cost: extra.mc || '' }, ...extra });
const st = (bf: any[], extra: any = {}) => ({ battlefield: bf, stack: [], players: [{ id: 'p1' }, { id: 'p2' }], life: { p1: 23, p2: 40 }, startingLife: 40, zones: { p1: { graveyard: [{ type_line: 'Instant' }, { type_line: 'Artifact Creature' }], hand: [] }, p2: { graveyard: [{ type_line: 'Land' }], hand: [] } }, turnPlayer: 'p1', ...extra });
const f = (k: string, fn: any) => { const [pw, tg] = k.split(' ')[1].split('/').map(Number); expect(fn(), k).toEqual({ power: pw, toughness: tg }); };
const pt = (c: any, s: any) => { syncDerivedContinuousEffects(s); return getCurrentPowerToughness(c, s); };

it('round 15: greatest-power CDA reads other creatures without recursing', () => {
  const O = "~'s power is equal to the greatest power among other creatures you control.";
  { const a = P('Echo', 'Creature \u2014 Shade', O.replace('~', 'Echo'), ['*', '3']); const b = P('Big', 'Creature \u2014 Giant', '', ['5', '5']); const o = P('Theirs', 'Creature \u2014 Giant', '', ['9', '9'], { controller: 'p2', owner: 'p2' }); f('echo 5/3', () => pt(a, st([a, b, o]))); }
  { const a = P('Echo', 'Creature \u2014 Shade', O.replace('~', 'Echo'), ['*', '3']); const b = P('Echo B', 'Creature \u2014 Shade', O.replace('~', 'Echo B'), ['*', '2']); const c = P('Bear', 'Creature \u2014 Bear', '', ['2', '2'], { counters: { '+1/+1': 2 } }); f('mutual 4/3', () => pt(a, st([a, b, c]))); }
  { const a = P('Mirror', 'Creature \u2014 Shade', "Mirror's power and toughness are each equal to the greatest power among other creatures on the battlefield.", ['*', '*']); const o = P('Theirs', 'Creature \u2014 Giant', '', ['7', '6'], { controller: 'p2', owner: 'p2' }); f('mirror 7/7', () => pt(a, st([a, o]))); }
  { const a = P('Lonely', 'Creature \u2014 Shade', O.replace('~', 'Lonely'), ['*', '1']); f('alone 0/1', () => pt(a, st([a]))); }
});
it('round 15: zone/resource self conditions, where-X and short-name counts, negative global anthem', () => {
  { const g = P('Gathan Raiders', 'Creature \u2014 Human Warrior', 'Hellbent \u2014 Gathan Raiders gets +2/+2 as long as you have no cards in hand.', ['3', '3']); f('hellbent 5/5', () => pt(g, st([g]))); f('hand 3/3', () => pt(g, st([g], { zones: { p1: { hand: [{}], graveyard: [] } } }))); }
  { const g = P('Blackbloom Rogue', 'Creature \u2014 Human Rogue', 'Menace\nBlackbloom Rogue gets +3/+0 as long as an opponent has eight or more cards in their graveyard.', ['2', '3']); const gy = Array.from({ length: 8 }, () => ({ type_line: 'Land' })); f('rogue 5/3', () => pt(g, st([g], { zones: { p1: { hand: [], graveyard: [] }, p2: { hand: [], graveyard: gy } } }))); f('rogue 2/3', () => pt(g, st([g]))); }
  { const l = P('Mountain', 'Basic Land \u2014 Mountain', '', undefined, { tapped: true }); const g = P('Spur Grappler', 'Creature \u2014 Beast', 'Spur Grappler gets +2/+1 as long as you control no untapped lands.', ['2', '1']); f('grappler 4/2', () => pt(g, st([l, g]))); l.tapped = false; f('grappler 2/1', () => pt(g, st([l, g]))); }
  { const g = P('Messenger Hawk', 'Creature \u2014 Bird', 'Flying\nMessenger Hawk gets +1/+0 as long as you\u2019ve drawn two or more cards this turn.', ['1', '2']); f('hawk 2/2', () => pt(g, st([g], { cardsDrawnThisTurn: { p1: 2 } }))); f('hawk 1/2', () => pt(g, st([g]))); }
  { const d = P("Death's Shadow", 'Creature \u2014 Avatar', "Death's Shadow gets -X/-X, where X is your life total.", ['13', '13']); f('shadow 3/3', () => pt(d, st([d], { life: { p1: 10, p2: 40 } }))); }
  { const k = P('Krang, Master Mind', 'Legendary Artifact Creature \u2014 Utrom', 'Krang gets +1/+0 for each other artifact you control.', ['1', '4']); const a = P('Sol Ring', 'Artifact', ''); const b = P('Mox', 'Artifact', ''); f('krang 3/4', () => pt(k, st([k, a, b]))); }
  { const fp = P('Fyndhorn Pollen', 'Enchantment', 'Cumulative upkeep {1}\nAll creatures get -1/-0.\n{1}{G}: All creatures get -1/-0 until end of turn.'); const c = P('Bear', 'Creature \u2014 Bear', '', ['2', '2']); f('pollen 1/2', () => pt(c, st([fp, c]))); }
  { const e = P('Witch', 'Creature \u2014 Human', 'When Witch enters, all creatures get -1/-1 until end of turn.', ['2', '2']); const c = P('Bear', 'Creature \u2014 Bear', '', ['2', '2']); f('etb 2/2', () => pt(c, st([e, c]))); }
});
