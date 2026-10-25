import { expect, it } from 'vitest';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec';
let n = 0;
const P = (name: string, type_line: string, oracle_text = '', pt = ['2','2'], extra: any = {}, colors = ['G'], mana_cost = '') => {
  const id = 'r8_' + (n++);
  return { id, controller: 'p1', owner: 'p1', counters: {}, ...extra, card: { id, name, type_line, oracle_text, power: pt[0], toughness: pt[1], colors, mana_cost } } as any;
};
const st = (bf: any[], gy: any[] = [], gy2: any[] = [], turnPlayer = 'p1') => ({ battlefield: bf, life: { p1: 40, p2: 40 }, startingLife: 40, players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], zones: { p1: { hand: [], graveyard: gy, handCount: 0, graveyardCount: gy.length }, p2: { hand: [], graveyard: gy2, handCount: 0, graveyardCount: gy2.length } }, turnPlayer, activePlayer: turnPlayer } as any);
const pt = (perm: any, s: any) => { syncDerivedContinuousEffects(s); return getCurrentPowerToughness(perm, s); };
const equip = (host: any, name: string, oracle: string, extra: any = {}) => { const e = P(name, 'Artifact \u2014 Equipment', oracle, ['',''], { attachedTo: host.id, ...extra }); host.attachments = [...(host.attachments || []), e.id]; return e; };
const gyCards = (lines: string[]) => lines.map((type_line, i) => ({ id: 'gc' + (n++) + '_' + i, name: 'G' + i, type_line }));

it('generic Otherwise on a self condition (your turn) flips with the condition', () => {
  const o = 'As long as it\'s your turn, Swinger gets +2/+2. Otherwise, Swinger gets -1/-1.';
  const a = P('Swinger', 'Creature \u2014 Bear', o); expect(pt(a, st([a]))).toEqual({ power: 4, toughness: 4 });
  const b = P('Swinger', 'Creature \u2014 Bear', o); expect(pt(b, st([b], [], [], 'p2'))).toEqual({ power: 1, toughness: 1 });
});
it("Serra's Boon: white host gets +1/+2, otherwise -2/-1", () => {
  const o = 'Enchant creature\nEnchanted creature gets +1/+2 as long as it\'s white. Otherwise, it gets -2/-1.';
  const w = P('Knight', 'Creature \u2014 Human', '', ['2','2'], {}, ['W']); const v = P("Serra's Boon", 'Enchantment \u2014 Aura', o, ['',''], { attachedTo: w.id }); w.attachments = [v.id];
  expect(pt(w, st([w, v]))).toEqual({ power: 3, toughness: 4 });
});
it('Otherwise on an attached type condition (non-creature-type wording)', () => {
  const b = P('Bear', 'Creature \u2014 Bear'); const v = P('Twisty', 'Enchantment \u2014 Aura', 'Enchant permanent\nAs long as enchanted permanent is a creature, it gets +1/+1. Otherwise, it gets +0/+0.', ['',''], { attachedTo: b.id }); b.attachments = [v.id];
  expect(pt(b, st([b, v]))).toEqual({ power: 3, toughness: 3 });
});
it('goyf wordings: Lhurgoyf, Mortivore, Nethergoyf, Cognivore, opponents\' graveyards', () => {
  const g1 = gyCards(['Creature \u2014 Elf', 'Instant', 'Land']); const g2 = gyCards(['Creature \u2014 Bear', 'Artifact Creature \u2014 Golem', 'Sorcery']);
  const l = P('Lhurgoyf', 'Creature \u2014 Lhurgoyf', "Lhurgoyf's power is equal to the number of creature cards in all graveyards and its toughness is equal to that number plus 1.", ['*','1+*']);
  expect(pt(l, st([l], g1, g2))).toEqual({ power: 3, toughness: 4 });
  const m = P('Mortivore', 'Creature \u2014 Lhurgoyf', "Mortivore's power and toughness are each equal to the number of creature cards in all graveyards.", ['*','*']);
  expect(pt(m, st([m], g1, g2))).toEqual({ power: 3, toughness: 3 });
  const ng = P('Nethergoyf', 'Creature \u2014 Lhurgoyf', "Nethergoyf's power is equal to the number of card types among cards in your graveyard and its toughness is equal to that number plus 1.", ['*','1+*']);
  expect(pt(ng, st([ng], g1, g2))).toEqual({ power: 3, toughness: 4 });
  const c = P('Cognivore', 'Creature \u2014 Lhurgoyf', "Cognivore's power and toughness are each equal to the number of instant cards in all graveyards.", ['*','*']);
  expect(pt(c, st([c], g1, g2))).toEqual({ power: 1, toughness: 1 });
  const op = P('Spiteful Goyf', 'Creature \u2014 Lhurgoyf', "Spiteful Goyf's power and toughness are each equal to the number of cards in your opponents' graveyards.", ['*','*']);
  expect(pt(op, st([op], g1, g2))).toEqual({ power: 3, toughness: 3 });
});
it('Colossus Hammer: +10/+10 and loses flying', () => {
  const b = P('Bird', 'Creature \u2014 Bird', 'Flying'); const e = equip(b, 'Colossus Hammer', 'Equipped creature gets +10/+10 and loses flying.\nEquip {8}');
  expect(pt(b, st([b, e]))).toEqual({ power: 12, toughness: 12 });
});
it('True-Faith Censer: additional bonus for a Human', () => {
  const h = P('Villager', 'Creature \u2014 Human'); const e = equip(h, 'True-Faith Censer', 'Equipped creature gets +1/+1 and has vigilance.\nAs long as equipped creature is a Human, it gets an additional +1/+0.\nEquip {3}');
  expect(pt(h, st([h, e]))).toEqual({ power: 4, toughness: 3 });
  const b = P('Bear', 'Creature \u2014 Bear'); const e2 = equip(b, 'True-Faith Censer', 'Equipped creature gets +1/+1 and has vigilance.\nAs long as equipped creature is a Human, it gets an additional +1/+0.\nEquip {3}');
  expect(pt(b, st([b, e2]))).toEqual({ power: 3, toughness: 3 });
});
it('Sigil of Distinction: +1/+0 per charge counter on the equipment', () => {
  const b = P('Bear', 'Creature \u2014 Bear'); const e = equip(b, 'Sigil of Distinction', 'Sigil of Distinction enters with X charge counters on it.\nEquipped creature gets +1/+0 for each charge counter on Sigil of Distinction.\nEquip\u2014Remove a charge counter from Sigil of Distinction.', { counters: { charge: 3 } });
  expect(pt(b, st([b, e]))).toEqual({ power: 5, toughness: 2 });
});
it('Soul of Eternity: P/T equal to life total', () => {
  const s = P('Soul of Eternity', 'Creature \u2014 Avatar', "Flying\nSoul of Eternity's power and toughness are each equal to your life total.", ['*','*']);
  expect(pt(s, st([s]))).toEqual({ power: 40, toughness: 40 });
});
it('Wu Admiral: +1/+1 as long as an opponent controls an Island', () => {
  const w = P('Wu Admiral', 'Creature \u2014 Human Soldier', 'Wu Admiral gets +1/+1 as long as an opponent controls an Island.', ['3','3']);
  const isl = P('Island', 'Basic Land \u2014 Island', '', ['',''], { controller: 'p2', owner: 'p2' });
  expect(pt(w, st([w, isl]))).toEqual({ power: 4, toughness: 4 });
  const w2 = P('Wu Admiral', 'Creature \u2014 Human Soldier', 'Wu Admiral gets +1/+1 as long as an opponent controls an Island.', ['3','3']);
  expect(pt(w2, st([w2]))).toEqual({ power: 3, toughness: 3 });
});
it('Renata: power equal to devotion to green', () => {
  const r = P('Renata, Called to the Hunt', 'Legendary Enchantment Creature \u2014 Demigod', "Renata's power is equal to your devotion to green.", ['*','4'], {}, ['G'], '{2}{G}');
  const g = P('Elf', 'Creature \u2014 Elf', '', ['1','1'], {}, ['G'], '{G}{G}');
  expect(pt(r, st([r, g]))).toEqual({ power: 3, toughness: 4 });
});

it('chosen type: Metallic Mimic is the chosen type (layer 4) and gets the chosen-type lord bonus', () => {
  const mimic = P('Metallic Mimic', 'Artifact Creature \u2014 Shapeshifter', 'As Metallic Mimic enters, choose a creature type.\nMetallic Mimic is the chosen type in addition to its other types.\nEach other creature you control of the chosen type enters with an additional +1/+1 counter on it.', ['2','1'], { chosenCreatureType: 'Elf' });
  const lord = P('Elf Lord', 'Creature \u2014 Elf', 'Other Elf creatures you control get +1/+1.', ['2','2']);
  expect(pt(mimic, st([mimic, lord]))).toEqual({ power: 3, toughness: 2 });
  const m2 = P('Metallic Mimic', 'Artifact Creature \u2014 Shapeshifter', 'As Metallic Mimic enters, choose a creature type.\nMetallic Mimic is the chosen type in addition to its other types.', ['2','1'], { chosenCreatureType: 'Elf' });
  const e = P('Etchings of the Chosen', 'Enchantment', 'As Etchings of the Chosen enters, choose a creature type.\nCreatures you control of the chosen type get +1/+1.', ['',''], { chosenCreatureType: 'Elf' });
  expect(pt(m2, st([m2, e]))).toEqual({ power: 3, toughness: 2 });
});
it('chosen type / chosen color lords: Radiant Destiny and Heraldic Banner', () => {
  const b = P('Elf', 'Creature \u2014 Elf'); const rd = P('Radiant Destiny', 'Enchantment', 'Ascend\nAs Radiant Destiny enters, choose a creature type.\nCreatures you control of the chosen type get +1/+1.\nAs long as you have the city\'s blessing, creatures you control of the chosen type also have vigilance.', ['',''], { chosenCreatureType: 'Elf' });
  expect(pt(b, st([b, rd]))).toEqual({ power: 3, toughness: 3 });
  const o = P('Bear', 'Creature \u2014 Bear'); const rd2 = P('Radiant Destiny', 'Enchantment', 'Creatures you control of the chosen type get +1/+1.', ['',''], { chosenCreatureType: 'Elf' });
  expect(pt(o, st([o, rd2]))).toEqual({ power: 2, toughness: 2 });
  const g = P('Bear', 'Creature \u2014 Bear'); const hb = P('Heraldic Banner', 'Artifact', 'As Heraldic Banner enters, choose a color.\nCreatures you control of the chosen color get +1/+0.\n{T}: Add one mana of the chosen color.', ['',''], { chosenColor: 'green' });
  expect(pt(g, st([g, hb]))).toEqual({ power: 3, toughness: 2 });
  const r = P('Bear', 'Creature \u2014 Bear', '', ['2','2'], {}, ['R']); const hb2 = P('Heraldic Banner', 'Artifact', 'Creatures you control of the chosen color get +1/+0.', ['',''], { chosenColor: 'green' });
  expect(pt(r, st([r, hb2]))).toEqual({ power: 2, toughness: 2 });
});
