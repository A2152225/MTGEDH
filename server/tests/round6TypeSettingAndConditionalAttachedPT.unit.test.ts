import { describe, it, expect } from 'vitest';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
import { getContinuousGrantedAbilitiesForPermanent, syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec';
import { getEffectiveColors } from '../src/state/modules/effectiveColors';
import { parseAttachedTypeSettingFromOracle } from '../src/state/modules/attachedTypeSettingStamp';
import { parseStaticAttachedPTBonusFromOracle } from '../src/state/utils-handlers/ptAttachedBonusParseHelpers';
import { isCurrentlyCreature } from '../src/socket/combat-handlers/combatLegalityGates';
import { TIMESTAMP_BASE } from '../../rules-engine/src/permanentTimestamps';

const T = TIMESTAMP_BASE + 2000;
let n = 0;
const P = (name: string, type_line: string, oracle_text = '', extra: any = {}) => {
  const id = 'r6_' + (n++);
  return { id, controller: 'p1', owner: 'p1', counters: {}, timestamp: T + n, ...extra, card: { id, name, type_line, oracle_text, power: '2', toughness: '2', colors: ['G'] } } as any;
};
const st = (bf: any[]) => ({ battlefield: bf, players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], zones: { p1: { hand: [], graveyard: [], handCount: 0 } }, turnPlayer: 'p1' } as any);
const CREATURE = 'Creature \u2014 Bear';
const attach = (host: any, aura: any) => { host.attachments = [...(host.attachments || []), aura.id]; return aura; };

const IMPRISONED = 'Enchant creature, land, or planeswalker\nEnchanted permanent is a colorless land with "{T}: Add {C}" and loses all other card types and abilities.';
const SCARAB = 'Enchant creature\nEnchanted creature can\'t be blocked by white creatures.\nEnchanted creature gets +2/+2 as long as an opponent controls a white permanent.';

describe('round 6: type-setting Auras', () => {
  it('parses Imprisoned in the Moon and Song of the Dryads', () => {
    expect(parseAttachedTypeSettingFromOracle(IMPRISONED)).toMatchObject({ cardTypes: ['land'], subtypes: [], colorless: true });
    expect(parseAttachedTypeSettingFromOracle('Enchant permanent\nEnchanted permanent is a colorless Forest land.')).toMatchObject({ cardTypes: ['land'], subtypes: ['Forest'], colorless: true });
    expect(parseAttachedTypeSettingFromOracle('Enchanted land is a 3/3 Elemental creature in addition to its other types.')).toBeNull();
    expect(parseAttachedTypeSettingFromOracle('Enchanted creature is a Treefolk.')).toBeNull();
  });
  it('Imprisoned host: not a creature, no P/T, colorless; cleared when the Aura leaves', () => {
    const b = P('Bear', CREATURE);
    const a = attach(b, P('Imprisoned in the Moon', 'Enchantment \u2014 Aura', IMPRISONED, { attachedTo: b.id }));
    const s = st([b, a]);
    syncDerivedContinuousEffects(s);
    expect(b.notCreature).toBe(true);
    expect(b.typeSetOverride.typeLine).toBe('Land');
    expect(getCurrentPowerToughness(b, s)).toBeUndefined();
    expect(getEffectiveColors(b, s)).toEqual([]);
    s.battlefield = [b];
    b.attachments = [];
    syncDerivedContinuousEffects(s);
    expect(b.notCreature).toBeUndefined();
    expect(b.typeSetOverride).toBeUndefined();
    expect(getCurrentPowerToughness(b, s)).toEqual({ power: 2, toughness: 2 });
    expect(getEffectiveColors(b, s)).toEqual(['G']);
  });
  it('does not clear a Theros-god notCreature it did not set', () => {
    const g = P('God', 'Legendary Enchantment Creature \u2014 God', '', { notCreature: true });
    syncDerivedContinuousEffects(st([g]));
    expect(g.notCreature).toBe(true);
  });
});

describe('round 6: conditional attached P/T', () => {
  it('legacy reader ignores "as long as" sentences', () => {
    expect(parseStaticAttachedPTBonusFromOracle(SCARAB)).toBeNull();
    expect(parseStaticAttachedPTBonusFromOracle('Enchanted creature gets +2/+2.')).toEqual({ power: 2, toughness: 2 });
  });
  it('Black Scarab: +2/+2 only while an opponent controls a white permanent', () => {
    const b = P('Bear', CREATURE);
    const a = attach(b, P('Black Scarab', 'Enchantment \u2014 Aura', SCARAB, { attachedTo: b.id }));
    const s = st([b, a]);
    expect(getCurrentPowerToughness(b, s)).toEqual({ power: 2, toughness: 2 });
    const mine = P('Plains Knight', CREATURE);
    mine.card.colors = ['W'];
    expect(getCurrentPowerToughness(b, st([b, a, mine]))).toEqual({ power: 2, toughness: 2 });
    const theirs = P('Opp Knight', CREATURE, '', { controller: 'p2' });
    theirs.card.colors = ['W'];
    expect(getCurrentPowerToughness(b, st([b, a, mine, theirs]))).toEqual({ power: 4, toughness: 4 });
  });
  it('Twisted Embrace: +1/+1 while the enchanted permanent is a creature', () => {
    const b = P('Bear', CREATURE);
    const a = attach(b, P('Twisted Embrace', 'Enchantment \u2014 Aura', 'Enchant permanent\nAs long as enchanted permanent is a creature, it gets +1/+1.', { attachedTo: b.id }));
    expect(getCurrentPowerToughness(b, st([b, a]))).toEqual({ power: 3, toughness: 3 });
  });
  it('equipment: +2/+0 and first strike only while attacking', () => {
    const b = P('Bear', CREATURE);
    const a = attach(b, P('Lance', 'Artifact \u2014 Equipment', 'Equipped creature gets +2/+0 and has first strike as long as it\'s attacking.', { attachedTo: b.id }));
    const s = st([b, a]);
    expect(getCurrentPowerToughness(b, s)).toEqual({ power: 2, toughness: 2 });
    b.attacking = 'p2';
    const s2 = st([b, a]);
    expect(getCurrentPowerToughness(b, s2)).toEqual({ power: 4, toughness: 2 });
    expect(getContinuousGrantedAbilitiesForPermanent(b, s2).join(' ')).toMatch(/first strike/i);
  });
});

describe('round 6: census P/T groups', () => {
  const swamp = (extra: any = {}) => P('Swamp', 'Basic Land \u2014 Swamp', '', extra);
  it('Nightmare: P/T = Swamps you control (generic CDA)', () => {
    const c = P('Nightmare', 'Creature \u2014 Nightmare Horse', "Flying\nNightmare's power and toughness are each equal to the number of Swamps you control.");
    c.card.power = '*'; c.card.toughness = '*';
    expect(getCurrentPowerToughness(c, st([c, swamp(), swamp(), swamp({ controller: 'p2' })]))).toEqual({ power: 2, toughness: 2 });
  });
  it('"other" excludes itself', () => {
    const c = P('Elf Counter', 'Creature \u2014 Elf', "This creature's power and toughness are each equal to the number of other Elves you control.");
    c.card.power = '*'; c.card.toughness = '*';
    const e = P('Llanowar Elves', 'Creature \u2014 Elf Druid');
    expect(getCurrentPowerToughness(c, st([c, e]))).toEqual({ power: 1, toughness: 1 });
  });
  it('Ensoul Artifact: host becomes a 5/5 creature; reverts when the Aura leaves', () => {
    const r = P('Bauble', 'Artifact');
    r.card.power = undefined; r.card.toughness = undefined;
    const e = attach(r, P('Ensoul Artifact', 'Enchantment \u2014 Aura', 'Enchant artifact\nEnchanted artifact is a creature with base power and toughness 5/5 in addition to its other types.', { attachedTo: r.id }));
    const s = st([r, e]);
    syncDerivedContinuousEffects(s);
    expect(isCurrentlyCreature(r, s.battlefield)).toBe(true);
    expect(getCurrentPowerToughness(r, s)).toEqual({ power: 5, toughness: 5 });
    r.attachments = [];
    syncDerivedContinuousEffects(st([r]));
    expect(r.isCreature).toBeUndefined();
    expect(isCurrentlyCreature(r)).toBe(false);
  });
});
