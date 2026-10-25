import { describe, it, expect } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing';
import { getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec';
import { getManaAbilitiesForPermanent } from '../src/state/modules/mana-abilities-handlers/manaAbilitiesForPermanent';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
import { TIMESTAMP_BASE } from '../../rules-engine/src/permanentTimestamps';

const T = TIMESTAMP_BASE + 1000;
let n = 0;
const P = (name: string, type_line: string, oracle_text = '', extra: any = {}) => {
  const id = 'r5_' + (n++);
  return { id, controller: 'p1', owner: 'p1', counters: {}, timestamp: T + n, ...extra, card: { id, name, type_line, oracle_text, power: '2', toughness: '2' } } as any;
};
const st = (bf: any[], zone: any = {}) => ({ battlefield: bf, players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], zones: { p1: { hand: [], graveyard: [], handCount: 0, ...zone } }, turnPlayer: 'p1' } as any);
const CREATURE = 'Creature \u2014 Horror';
const pt = (p: any, s: any) => getCurrentPowerToughness(p, s);

describe('round 5: quoted land grants', () => {
  const landWith = (oracle: string) => { const src = P('Src', 'Artifact', oracle); const land = P('Wastes', 'Basic Land \u2014 Wastes'); return { land, s: st([src, land]) }; };
  it('{C}{C} grants two colorless, not one', () => {
    const { land, s } = landWith('Lands you control have "{T}: Add {C}{C}."');
    const mana = getManaAbilitiesForPermanent(s, land, 'p1');
    expect(mana.some((a: any) => a.produces.join() === 'C' && a.amount === 2)).toBe(true);
    expect(mana.some((a: any) => a.produces.join() === 'C' && !a.amount)).toBe(false);
  });
  it('Tectonic Split: three mana of any one color', () => {
    const { land, s } = landWith('Lands you control have "{T}: Add three mana of any one color."');
    expect(getManaAbilitiesForPermanent(s, land, 'p1').some((a: any) => a.produces.length === 5 && a.amount === 3)).toBe(true);
  });
  it('Resonating Lute keeps its spend restriction', () => {
    const { land, s } = landWith('Lands you control have "{T}: Add two mana of any one color. Spend this mana only to cast instant and sorcery spells."');
    const row: any = getManaAbilitiesForPermanent(s, land, 'p1').find((a: any) => a.amount === 2);
    expect(row).toBeTruthy();
    expect(row.spendRestriction).toBeTruthy();
  });
  it("Bootleggers' Stash grants a non-mana quoted ability", () => {
    const { land, s } = landWith('Lands you control have "{T}: Create a Treasure token."');
    expect(getContinuousGrantedAbilitiesForPermanent(land, s)).toContain('{t}: create a treasure token.');
  });
  it('Chromatic Lantern still uses the token path', () => {
    const src = P('Chromatic Lantern', 'Artifact', 'Lands you control have "{T}: Add one mana of any color."');
    const spec: any = parseStaticEffectSpecsFromOraclePermanent(src).find((x: any) => x.scope.kind === 'lands_you_control');
    expect(spec.grant.abilities).toEqual(['tap_for_any_color']);
  });
});

describe('round 5: attached penalties and counted P/T', () => {
  it('Quantum Reduction: -5/-0 on the host', () => {
    const b = P('Bear', CREATURE, 'Flying');
    const a = P('Quantum Reduction', 'Enchantment \u2014 Aura', 'Enchant creature\nEnchanted creature gets -5/-0 and loses all abilities.', { attachedTo: b.id });
    b.attachments = [a.id];
    expect(pt(b, st([b, a]))).toEqual({ power: -3, toughness: 2 });
  });
  it('Bride\'s Gown stays on the legacy reader (no double count)', () => {
    const b = P('Bear', CREATURE);
    const a = P("Bride's Gown", 'Artifact \u2014 Equipment', 'Equipped creature gets +2/+0.', { attachedTo: b.id });
    b.attachments = [a.id];
    expect(parseStaticEffectSpecsFromOraclePermanent(a)).toHaveLength(0);
    expect(pt(b, st([b, a]))).toEqual({ power: 4, toughness: 2 });
  });
  it('Nim Lasher counts artifacts you control', () => {
    const c = P('Nim Lasher', CREATURE, 'This creature gets +1/+0 for each artifact you control.');
    expect(pt(c, st([c, P('A', 'Artifact'), P('B', 'Artifact')]))).toEqual({ power: 4, toughness: 2 });
  });
  it('Kor Spiritdancer counts Auras attached to it', () => {
    const c = P('Kor Spiritdancer', CREATURE, 'This creature gets +2/+2 for each Aura attached to it.');
    const a = P('Aura', 'Enchantment \u2014 Aura', 'Enchant creature', { attachedTo: c.id });
    expect(pt(c, st([c, a]))).toEqual({ power: 4, toughness: 4 });
  });
  it('Necrosquito counts oil counters', () => {
    const c = P('Necrosquito', CREATURE, 'This creature gets +1/+1 for each oil counter on it.', { counters: { oil: 2 } });
    expect(pt(c, st([c]))).toEqual({ power: 4, toughness: 4 });
  });
  it('Dread Slag counts cards in hand', () => {
    const c = P('Dread Slag', CREATURE, 'This creature gets -4/-4 for each card in your hand.');
    c.card.power = '9'; c.card.toughness = '9';
    expect(pt(c, st([c], { handCount: 2 }))).toEqual({ power: 1, toughness: 1 });
  });
  it('Fiend Artisan counts creature cards in your graveyard', () => {
    const c = P('Fiend Artisan', CREATURE, 'This creature gets +1/+1 for each creature card in your graveyard.');
    const gy = [{ id: 'g1', type_line: 'Creature \u2014 Elf' }, { id: 'g2', type_line: 'Instant' }, { id: 'g3', type_line: 'Artifact Creature \u2014 Golem' }];
    expect(pt(c, st([c], { graveyard: gy }))).toEqual({ power: 4, toughness: 4 });
  });
  it('Pennon Blade counts creatures you control', () => {
    const c = P('Bear', CREATURE);
    const e = P('Pennon Blade', 'Artifact \u2014 Equipment', 'Equipped creature gets +1/+1 for each creature you control.', { attachedTo: c.id });
    c.attachments = [e.id];
    expect(pt(c, st([c, e, P('Other', CREATURE)]))).toEqual({ power: 4, toughness: 4 });
  });
  it('Strong Back counts Auras and Equipment attached to the host', () => {
    const c = P('Bear', CREATURE);
    const a = P('Strong Back', 'Enchantment \u2014 Aura', 'Enchant creature\nEnchanted creature gets +2/+2 for each Aura and Equipment attached to it.', { attachedTo: c.id });
    const e = P('Stick', 'Artifact \u2014 Equipment', 'Equip {1}', { attachedTo: c.id });
    c.attachments = [a.id, e.id];
    expect(pt(c, st([c, a, e]))).toEqual({ power: 6, toughness: 6 });
  });
});

describe('round 5: keyword qualifier sees continuously granted keywords', () => {
  it('a lord granting flying feeds "Creatures with flying get +1/+0"', () => {
    const lord = P('Lord', 'Enchantment', 'Creatures you control have flying.');
    const buff = P('Buff', 'Enchantment', 'Creatures with flying get +1/+0.');
    const c = P('Bear', CREATURE);
    expect(pt(c, st([lord, buff, c]))).toEqual({ power: 3, toughness: 2 });
    expect(pt(c, st([buff, c]))).toEqual({ power: 2, toughness: 2 });
  });
  it('two keyword-qualified statics do not loop', () => {
    const a = P('A', 'Enchantment', 'Creatures with flying have vigilance.');
    const b = P('B', 'Enchantment', 'Creatures with vigilance have flying.');
    const c = P('Bear', CREATURE, 'Flying');
    expect(getContinuousGrantedAbilitiesForPermanent(c, st([a, b, c]))).toContain('vigilance');
  });
});
