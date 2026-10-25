import { expect, it } from 'vitest';
import { applyPermanentBecomeCopyOfTargetPermanent } from '../src/state/modules/permanent-copy';
import { applyOracleIrSpellLifelinkGain } from '../src/state/modules/spellLifelinkGrant';
import { getPaidUntapOffers, applyPaidUntapChoice } from '../src/state/modules/upkeepPaidUntapChoice';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec';
let n = 0;
const P = (name: string, type_line: string, oracle_text = '', pt = ['2','2'], extra: any = {}, colors = ['G']) => { const id = 'r11_' + (n++); return { id, controller: 'p1', owner: 'p1', counters: {}, ...extra, card: { id, name, type_line, oracle_text, power: pt[0], toughness: pt[1], colors } } as any; };
const st = (bf: any[], extra: any = {}) => ({ battlefield: bf, stack: [], life: { p1: 23, p2: 40 }, players: [{ id: 'p1', life: 23 }, { id: 'p2', life: 40 }], zones: { p1: { hand: [], graveyard: [{ type_line: 'Instant' }, { type_line: 'Artifact Creature \u2014 Golem' }] }, p2: { hand: [], graveyard: [{ type_line: 'Land' }] } }, turnPlayer: 'p1', ...extra } as any);
const pt = (perm: any, s: any) => { syncDerivedContinuousEffects(s); return getCurrentPowerToughness(perm, s); };

it('Spark Double copying a planeswalker gets printed loyalty + 1 and no +1/+1 counter', () => {
  const pw = P('Jace', 'Legendary Planeswalker \u2014 Jace', '+1: Draw a card.', ['',''], { counters: { loyalty: 6 }, loyalty: 6 });
  pw.card.loyalty = '3';
  const sd = P('Spark Double', 'Creature \u2014 Illusion', "You may have Spark Double enter as a copy of a creature or planeswalker you control, except it enters with an additional +1/+1 counter on it if it's a creature, it enters with an additional loyalty counter on it if it's a planeswalker, and it isn't legendary.", ['0','0']);
  applyPermanentBecomeCopyOfTargetPermanent(st([pw, sd]), sd.id, pw.id);
  expect(sd.card.type_line).not.toMatch(/Legendary/);
  expect(sd.counters.loyalty).toBe(4);
  expect(sd.counters['+1/+1'] || 0).toBe(0);
});

it('Oracle IR damage spell with granted lifelink gains life equal to damage dealt', () => {
  const rs = P('Radiant Scrollwielder', 'Creature \u2014 Dwarf Cleric', 'Instant and sorcery spells you control have lifelink.', ['2','4']);
  const bear = P('Bear', 'Creature \u2014 Bear', '', ['2','2'], { controller: 'p2', damage: 0 });
  const s = st([rs, bear]);
  const before = { lifeByPlayer: new Map([['p1', 23], ['p2', 40]]), permanents: new Map([[rs.id, { damage: 0 }], [bear.id, { damage: 0 }]]) };
  s.life.p2 = 37; bear.damage = 2;
  const item = { id: 'fire', controller: 'p1', card: { name: 'Fire // Ice', type_line: 'Instant', oracle_text: 'Fire deals 2 damage divided as you choose' } };
  const ctx: any = { state: s };
  expect(applyOracleIrSpellLifelinkGain(ctx, { appliedSteps: [{ kind: 'deal_damage' }] }, before, { controller: 'p1', sourceId: 'fire', sourceItem: item })).toBe(5);
  expect(s.life.p1).toBe(28);
  // Non-damage steps and permanent sources do nothing.
  expect(applyOracleIrSpellLifelinkGain(ctx, { appliedSteps: [{ kind: 'draw' }] }, before, { controller: 'p1', sourceId: 'fire', sourceItem: item })).toBe(0);
  expect(applyOracleIrSpellLifelinkGain(ctx, { appliedSteps: [{ kind: 'deal_damage' }] }, before, { controller: 'p1', sourceId: rs.id })).toBe(0);
});

it('Magnetic Mountain paid untap offers tapped blue creatures and charges {4} each', () => {
  const mm = P('Magnetic Mountain', 'Enchantment', "Blue creatures don't untap during their controllers' untap steps.\nAt the beginning of each player's upkeep, that player may choose any number of tapped blue creatures they control and pay {4} for each creature chosen this way. If the player does, untap those creatures.", ['',''], { controller: 'p2' }, ['R']);
  const b1 = P('Blue1', 'Creature \u2014 Merfolk', '', ['1','1'], { tapped: true }, ['U']);
  const b2 = P('Blue2', 'Creature \u2014 Merfolk', '', ['1','1'], { tapped: true }, ['U']);
  const g = P('Green', 'Creature \u2014 Elf', '', ['1','1'], { tapped: true }, ['G']);
  const s = st([mm, b1, b2, g]);
  const offers = getPaidUntapOffers(s, 'p1');
  expect(offers).toHaveLength(1);
  expect(offers[0].eligibleIds.sort()).toEqual([b1.id, b2.id].sort());
  const r = applyPaidUntapChoice(s, 'p1', mm.id, [b1.id, g.id]);
  expect(r).toEqual({ untapped: [b1.id], cost: 4 });
  expect(b1.tapped).toBe(false); expect(b2.tapped).toBe(true); expect(g.tapped).toBe(true);
});

it('layer 7 count-equal P/T: Tarmogoyf and life-total CDA', () => {
  const goy = P('Tarmogoyf', 'Creature \u2014 Lhurgoyf', "Tarmogoyf's power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1.", ['*','1+*']);
  expect(pt(goy, st([goy]))).toEqual({ power: 4, toughness: 5 });
  const soe = P('Soul of Eternity', 'Creature \u2014 Avatar', "Soul of Eternity's power and toughness are each equal to your life total.", ['*','*']);
  expect(pt(soe, st([soe]))).toEqual({ power: 23, toughness: 23 });
});
