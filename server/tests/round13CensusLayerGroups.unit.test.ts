import { describe, it, expect } from 'vitest';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
import { getCreatureTypesNow } from '../src/state/creatureTypeNow';

let n = 0;
const P = (name: string, tl: string, o: string, pt?: [string, string], extra: any = {}) => ({ id: 'x' + (++n), controller: 'p1', owner: 'p1', counters: {}, tapped: false, card: { id: 'c' + n, name, type_line: tl, oracle_text: o, power: pt?.[0], toughness: pt?.[1] }, ...extra });
const st = (bf: any[]) => ({ battlefield: bf, stack: [], players: [{ id: 'p1' }, { id: 'p2' }], life: { p1: 40, p2: 40 }, zones: { p1: { graveyard: [], hand: [] }, p2: { graveyard: [], hand: [] } }, turnPlayer: 'p1' });
const pt = (c: any, s: any) => { syncDerivedContinuousEffects(s); return getCurrentPowerToughness(c, s); };

describe('round 13 census layer groups', () => {
  it('party "is also a" types apply with no other static on the battlefield (Tajuru Paragon, Burakos)', () => {
    const tp = P('Tajuru Paragon', 'Creature \u2014 Elf Cleric', 'Kicker {3}\nTajuru Paragon is also a Cleric, Rogue, Warrior, and Wizard.', ['3', '2']);
    const bk = P('Burakos, Party Leader', 'Legendary Creature \u2014 Orc Rogue', 'Burakos, Party Leader is also a Cleric, Rogue, Warrior, and Wizard.', ['2', '3']);
    syncDerivedContinuousEffects(st([tp, bk]));
    expect([...getCreatureTypesNow(tp as any)].sort()).toEqual(['cleric', 'elf', 'rogue', 'warrior', 'wizard']);
    expect([...getCreatureTypesNow(bk as any)].sort()).toEqual(['cleric', 'orc', 'rogue', 'warrior', 'wizard']);
  });

  it('Earth Servant gets +0/+1 per Mountain, counting "Enchanted land is a Mountain"', () => {
    const m = P('Mountain', 'Basic Land \u2014 Mountain', '');
    const pl = P('Plains', 'Basic Land \u2014 Plains', '');
    const au = P('Volcanic Upheaval Aura', 'Enchantment \u2014 Aura', 'Enchant land\nEnchanted land is a Mountain.', undefined, { attachedTo: pl.id });
    const es = P('Earth Servant', 'Creature \u2014 Elemental', 'Earth Servant gets +0/+1 for each Mountain you control.', ['4', '4']);
    expect(pt(es, st([m, es]))).toMatchObject({ power: 4, toughness: 5 });
    expect(pt(es, st([m, pl, au, es]))).toMatchObject({ power: 4, toughness: 6 });
  });

  it('Magemark pumps only enchanted creatures you control', () => {
    const c = P('Bear', 'Creature \u2014 Bear', '', ['2', '2']);
    const bare = P('Bare Bear', 'Creature \u2014 Bear', '', ['2', '2']);
    const au = P('Pacifism', 'Enchantment \u2014 Aura', 'Enchant creature', undefined, { attachedTo: c.id });
    const mm = P("Guardian's Magemark", 'Enchantment \u2014 Aura', 'Flash\nEnchant creature\nCreatures you control that are enchanted get +1/+1.', undefined, { attachedTo: 'nowhere' });
    const s = st([c, bare, au, mm]);
    expect(pt(c, s)).toMatchObject({ power: 3, toughness: 3 });
    expect(pt(bare, s)).toMatchObject({ power: 2, toughness: 2 });
  });

  it('Strength of Unity counts basic land types among your lands', () => {
    const fo = P('Forest', 'Basic Land \u2014 Forest', '');
    const is = P('Island', 'Basic Land \u2014 Island', '');
    const is2 = P('Island', 'Basic Land \u2014 Island', '');
    const c = P('Bear', 'Creature \u2014 Bear', '', ['2', '2']);
    const su = P('Strength of Unity', 'Enchantment \u2014 Aura', 'Enchant creature\nDomain \u2014 Enchanted creature gets +1/+1 for each basic land type among lands you control.', undefined, { attachedTo: c.id });
    expect(pt(c, st([fo, is, is2, c, su]))).toMatchObject({ power: 4, toughness: 4 });
  });
});
