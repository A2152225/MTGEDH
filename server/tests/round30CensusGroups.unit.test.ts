import { describe, it, expect } from 'vitest';
import { parseBorrowedActivatedClause } from '../src/state/modules/staticEffectSpecBorrowedActivated';
import { getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify';

function perm(id: string, controller: string, name: string, type_line: string, oracle_text: string, extra: any = {}) {
  return { id, controller, ...extra, card: { id: id + '_c', name, type_line, oracle_text } };
}
const LOOT = '{1}, {T}: Draw a card, then discard a card.';
const MANA = '{T}: Add {G}.';
const has = (list: string[], s: string) => list.some((a) => a.toLowerCase().includes(s));

describe('round 30: borrowed activated abilities', () => {
  it('parses the clause families', () => {
    expect(parseBorrowedActivatedClause('all creature cards in all graveyards')).toMatchObject({ zone: 'graveyard', owner: 'all', typeWords: ['creature'] });
    expect(parseBorrowedActivatedClause('all elf cards in your graveyard')).toMatchObject({ owner: 'you', typeWords: ['elf'] });
    expect(parseBorrowedActivatedClause('all legendary creatures you control')).toMatchObject({ zone: 'battlefield', typeWords: ['legendary', 'creature'] });
    expect(parseBorrowedActivatedClause("lands your opponents control except mana abilities")).toMatchObject({ owner: 'opponents', excludeMana: true });
    expect(parseBorrowedActivatedClause("creatures you control that don't have the same name as ~")).toMatchObject({ excludeSameName: true });
    expect(parseBorrowedActivatedClause('all cards you own in exile with cage counters on them')).toMatchObject({ zone: 'exile', counterType: 'cage', owner: 'you' });
    expect(parseBorrowedActivatedClause('all cards exiled with it')).toMatchObject({ zone: 'exiled_with', typeWords: [] });
    expect(parseBorrowedActivatedClause('each other creature with a +1/+1 counter on it')).toMatchObject({ counterType: '+1/+1' });
    expect(parseBorrowedActivatedClause('that card')).toBeNull();
  });

  it('graveyard family (Necrotic Ooze style)', () => {
    const ooze = perm('o', 'p1', 'Census Ooze', 'Creature \u2014 Ooze', 'As long as Census Ooze is on the battlefield, it has all activated abilities of all creature cards in all graveyards.');
    const state: any = { battlefield: [ooze], zones: { p1: { graveyard: [] }, p2: { graveyard: [{ name: 'Looter', type_line: 'Creature \u2014 Human', oracle_text: LOOT }, { name: 'Relic', type_line: 'Artifact', oracle_text: '{T}: Gain 1 life.' }] } } };
    const got = getContinuousGrantedAbilitiesForPermanent(ooze as any, state);
    expect(has(got, 'draw a card')).toBe(true);
    expect(has(got, 'gain 1 life')).toBe(false);
  });

  it('battlefield family with mana exclusion and same-name exclusion', () => {
    const shark = perm('s', 'p1', 'Census Shark', 'Creature', 'Census Shark has all activated abilities of lands your opponents control except mana abilities.');
    const land = perm('l', 'p2', 'Odd Land', 'Land', MANA + '\n{2}, {T}: Scry 1.');
    const own = perm('l2', 'p1', 'My Land', 'Land', '{3}, {T}: Draw a card.');
    let got = getContinuousGrantedAbilitiesForPermanent(shark as any, { battlefield: [shark, land, own] } as any);
    expect(has(got, 'scry 1')).toBe(true);
    expect(has(got, 'add {g}')).toBe(false);
    expect(has(got, 'draw a card')).toBe(false);
    const mimic = perm('m', 'p1', 'Census Mimic', 'Creature', "Census Mimic has all activated abilities of creatures you control that don't have the same name as this creature.");
    const twin = perm('m2', 'p1', 'Census Mimic', 'Creature', '{T}: Scry 2.');
    const other = perm('x', 'p1', 'Pinger', 'Creature', '{T}: Scry 3.');
    got = getContinuousGrantedAbilitiesForPermanent(mimic as any, { battlefield: [mimic, twin, other] } as any);
    expect(has(got, 'scry 3')).toBe(true);
    expect(has(got, 'scry 2')).toBe(false);
  });

  it('exile-with-counters family (Mairsil style)', () => {
    const m = perm('ma', 'p1', 'Census Pretender', 'Creature', 'Census Pretender has all activated abilities of all cards you own in exile with cage counters on them.');
    const state: any = { battlefield: [m], zones: { p1: { exile: [{ name: 'Caged', type_line: 'Artifact', oracle_text: '{T}: Scry 1.', counters: { cage: 1 } }, { name: 'Loose', type_line: 'Artifact', oracle_text: '{T}: Scry 4.' }] } } };
    const got = getContinuousGrantedAbilitiesForPermanent(m as any, state);
    expect(has(got, 'scry 1')).toBe(true);
    expect(has(got, 'scry 4')).toBe(false);
  });

  it('classifies the census lines', () => {
    const sys = (l: string, n: string) => classifyStaticCensusLine(l, n)?.system;
    expect(sys('As long as Census Ooze is on the battlefield, it has all activated abilities of all creature cards in all graveyards.', 'Census Ooze')).toMatch(/borrowed activated/);
    expect(sys('Census Merc has all activated abilities of all legendary creatures you control.', 'Census Merc')).toMatch(/borrowed activated/);
  });
});

import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator';

describe('round 30: generic count CDA extensions', () => {
  const c = (name: string, text: string) => ({ id: 'cda', name, type_line: 'Creature', power: '*', toughness: '*', oracle_text: text, controller: 'p1' });
  const bf = (card: any, others: any[]) => [{ id: 'cda', controller: 'p1', card }, ...others];
  it('sums two counts with subtype filters (Dauntless Dourbark style)', () => {
    const card: any = c('Census Bark', "Census Bark's power and toughness are each equal to the number of Forests you control plus the number of Treefolk you control.");
    const others = [{ id: 'f', controller: 'p1', card: { type_line: 'Basic Land \u2014 Forest' } }, { id: 't', controller: 'p1', card: { type_line: 'Creature \u2014 Treefolk' } }, { id: 'f2', controller: 'p2', card: { type_line: 'Basic Land \u2014 Forest' } }];
    expect(calculateVariablePT(card, { battlefield: bf(card, others) })).toEqual({ power: 2, toughness: 2 });
  });
  it('N plus subtype-or-subtype you control (Aysen Crusader style)', () => {
    const card: any = c('Census Crusader', "Census Crusader's power and toughness are each equal to 2 plus the number of Soldiers and Warriors you control.");
    const others = [{ id: 's', controller: 'p1', card: { type_line: 'Creature \u2014 Human Soldier' } }, { id: 'w', controller: 'p1', card: { type_line: 'Creature \u2014 Orc Warrior' } }];
    expect(calculateVariablePT(card, { battlefield: bf(card, others) })).toEqual({ power: 4, toughness: 4 });
  });
  it('battlefield plus graveyard subtype counts (Soulless One style)', () => {
    const card: any = c('Census Soulless', "Census Soulless's power and toughness are each equal to the number of Zombies on the battlefield plus the number of Zombie cards in all graveyards.");
    const z = { type_line: 'Creature \u2014 Zombie' };
    const state: any = { battlefield: bf({ ...card, type_line: 'Creature \u2014 Zombie Avatar' }, [{ id: 'z', controller: 'p2', card: z }]), zones: { p1: { graveyard: [z] }, p2: { graveyard: [z, { type_line: 'Instant' }] } } };
    state.battlefield[0].card = card; card.type_line = 'Creature \u2014 Zombie Avatar';
    expect(calculateVariablePT(card, state)).toEqual({ power: 4, toughness: 4 });
  });
  it('cards exiled with it (Unlicensed Hearse style)', () => {
    const card: any = c('Census Hearse', "Census Hearse's power and toughness are each equal to the number of cards exiled with it.");
    const state: any = { battlefield: bf(card, []), zones: { p2: { exile: [{ id: 'a', exiledWithSourceId: 'cda' }, { id: 'b', exiledWithSourceId: 'zz' }, { id: 'c', exiledWithSourceId: 'cda' }] } } };
    expect(calculateVariablePT(card, state)).toEqual({ power: 2, toughness: 2 });
  });
});
