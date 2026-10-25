import { describe, it, expect } from 'vitest';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec';
import { getCreatureTypesNow, isCreatureNow } from '../src/state/creatureTypeNow';
import { permanentLosesKeyword } from '../../rules-engine/src/permanentKeywordAbilities';
import { TIMESTAMP_BASE } from '../../rules-engine/src/permanentTimestamps';

const T = TIMESTAMP_BASE + 3000;
let n = 0;
const P = (name: string, type_line: string, oracle_text = '', extra: any = {}) => {
  const id = 'r7_' + (n++);
  return { id, controller: 'p1', owner: 'p1', counters: {}, timestamp: T + n, ...extra, card: { id, name, type_line, oracle_text, power: '2', toughness: '2', colors: ['G'] } } as any;
};
const st = (bf: any[]) => ({ battlefield: bf, players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], zones: { p1: { hand: [], graveyard: [], handCount: 0 } }, turnPlayer: 'p1' } as any);
const aura = (host: any, name: string, oracle: string, ts: number, type = 'Enchantment \u2014 Aura') => {
  const a = P(name, type, oracle, { attachedTo: host.id, attachedTimestamp: ts, attachedTimestampFor: host.id });
  host.attachments = [...(host.attachments || []), a.id];
  return a;
};
const IMPRISONED = 'Enchant creature, land, or planeswalker\nEnchanted permanent is a colorless land with "{T}: Add {C}" and loses all other card types and abilities.';
const SONG = 'Enchant permanent\nEnchanted permanent is a colorless Forest land.';
const ENSOUL = 'Enchant artifact\nEnchanted artifact is a creature with base power and toughness 5/5 in addition to its other types.';
const HUMILITY = 'All creatures lose all abilities and have base power and toughness 1/1.';

describe('round 7: type-setting subtypes, supertypes and abilities', () => {
  it('Imprisoned strips creature subtypes and abilities, keeps Legendary', () => {
    const elf = P('Elf Lord', 'Legendary Creature \u2014 Elf Warrior', 'Flying\nOther Elves you control get +1/+1.');
    const other = P('Elf', 'Creature \u2014 Elf');
    const a = aura(elf, 'Imprisoned in the Moon', IMPRISONED, T + 100);
    const s = st([elf, other, a]);
    syncDerivedContinuousEffects(s);
    expect(elf.typeSetOverride.typeLine).toBe('Legendary Land');
    expect(isCreatureNow(elf)).toBe(false);
    expect(getCreatureTypesNow(elf).size).toBe(0);
    expect(permanentLosesKeyword(elf, 'flying', s.battlefield)).toBe(true);
    expect(getCurrentPowerToughness(other, s)).toEqual({ power: 2, toughness: 2 }); // lord ability gone
  });
  it('Song of the Dryads sets Forest but keeps abilities; clears its stamps when removed', () => {
    const b = P('Bird', 'Creature \u2014 Bird', 'Flying');
    const a = aura(b, 'Song of the Dryads', SONG, T + 100);
    const s = st([b, a]);
    syncDerivedContinuousEffects(s);
    expect(b.typeSetOverride.typeLine).toBe('Land \u2014 Forest');
    expect(permanentLosesKeyword(b, 'flying', s.battlefield)).toBe(false);
    expect(isCreatureNow(b)).toBe(false);
    b.attachments = [];
    const s2 = st([b]);
    syncDerivedContinuousEffects(s2);
    expect(b.typeSetOverride).toBeUndefined();
    expect(b.typesReplaced).toBeUndefined();
    expect(isCreatureNow(b)).toBe(true);
    expect(getCreatureTypesNow(b).has('bird')).toBe(true);
  });
  it('never clears a typesReplaced it did not set', () => {
    const b = P('X', 'Creature \u2014 Bear', '', { typesReplaced: true, effectiveTypes: ['Artifact'] });
    syncDerivedContinuousEffects(st([b]));
    expect(b.typesReplaced).toBe(true);
    expect(b.effectiveTypes).toEqual(['Artifact']);
  });
});

describe('round 7: layer 4 timestamp order', () => {
  it('the later of two type-setters wins', () => {
    const b = P('Bear', 'Creature \u2014 Bear');
    const a1 = aura(b, 'Song of the Dryads', SONG, T + 200);
    const a2 = aura(b, 'Imprisoned in the Moon', IMPRISONED, T + 100);
    syncDerivedContinuousEffects(st([b, a1, a2]));
    expect(b.typeSetOverride.subtypes).toEqual(['Forest']);
    const c = P('Bear', 'Creature \u2014 Bear');
    const c1 = aura(c, 'Song of the Dryads', SONG, T + 100);
    const c2 = aura(c, 'Imprisoned in the Moon', IMPRISONED, T + 200);
    syncDerivedContinuousEffects(st([c, c1, c2]));
    expect(c.typeSetOverride.subtypes).toEqual([]);
  });
  it('Ensoul Artifact after Imprisoned re-adds Creature (5/5); before it is overwritten', () => {
    const art = P('Relic', 'Artifact');
    const imp = aura(art, 'Imprisoned in the Moon', IMPRISONED, T + 100);
    const ens = aura(art, 'Ensoul Artifact', ENSOUL, T + 200);
    const s = st([art, imp, ens]);
    syncDerivedContinuousEffects(s);
    expect(art.typeSetOverride.typeLine).toBe('Land Creature');
    expect(art.notCreature).toBeUndefined();
    expect(getCurrentPowerToughness(art, s)).toEqual({ power: 5, toughness: 5 });

    const art2 = P('Relic', 'Artifact');
    const ens2 = aura(art2, 'Ensoul Artifact', ENSOUL, T + 100);
    const imp2 = aura(art2, 'Imprisoned in the Moon', IMPRISONED, T + 200);
    const s2 = st([art2, ens2, imp2]);
    syncDerivedContinuousEffects(s2);
    expect(art2.typeSetOverride.typeLine).toBe('Land');
    expect(art2.notCreature).toBe(true);
    expect(isCreatureNow(art2)).toBe(false);
    expect(getCurrentPowerToughness(art2, s2)).toBeUndefined();
  });
});

describe('round 7: Humility interaction', () => {
  it('Humility does not touch an Imprisoned (non-creature) host', () => {
    const h = P('Humility', 'Enchantment', HUMILITY, { timestamp: T + 300 });
    const b = P('Bear', 'Creature \u2014 Bear');
    const a = aura(b, 'Imprisoned in the Moon', IMPRISONED, T + 100);
    const s = st([h, b, a]);
    syncDerivedContinuousEffects(s);
    expect(getCurrentPowerToughness(b, s)).toBeUndefined();
  });
  it('Humility vs Ensoul on an Imprisoned artifact: later 7b timestamp wins', () => {
    const art = P('Relic', 'Artifact');
    const imp = aura(art, 'Imprisoned in the Moon', IMPRISONED, T + 100);
    const ens = aura(art, 'Ensoul Artifact', ENSOUL, T + 200);
    const hLate = P('Humility', 'Enchantment', HUMILITY, { timestamp: T + 300 });
    const s = st([art, imp, ens, hLate]);
    syncDerivedContinuousEffects(s);
    expect(getCurrentPowerToughness(art, s)).toEqual({ power: 1, toughness: 1 });
  });
});
