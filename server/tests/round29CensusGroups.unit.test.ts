import { describe, it, expect } from 'vitest';
import { pushCantAttackBlockSpecs } from '../src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingCantAttack';
import { permanentActivatedAbilitiesLockedByAttachment } from '../src/state/modules/staticActivationLockFromAttachments';
import { hasAsEntersPayAnyLife, getAsEntersPayAnyLifeMax, applyAsEntersPayAnyLifeChoice, getLifePaidOnEntryPT } from '../src/state/modules/asEntersPayAnyLife';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator';
import { parseGenericCountCDA } from '../src/state/utils-handlers/variablePTGenericCountCDA';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify';

const FETTERS = "Enchant permanent\nEnchanted permanent can't attack or block, and its activated abilities can't be activated unless they're mana abilities.";

function cda(name: string, text: string, extra: any = {}) {
  return { id: 'cda', name, type_line: 'Creature', power: '*', toughness: '*', oracle_text: text, controller: 'p1', ...extra };
}

describe('round 29: Fetters-style locks', () => {
  it('locks combat on the enchanted permanent despite the mana-ability unless clause', () => {
    const specs: any[] = [];
    const aura: any = { id: 'f', controller: 'p2', attachedTo: 'art', card: { name: 'Census Fetters', type_line: 'Enchantment \u2014 Aura', oracle_text: FETTERS } };
    pushCantAttackBlockSpecs(specs, { sourcePermanentId: 'f', sourceName: 'Census Fetters', controllerId: 'p2' } as any, aura, FETTERS.toLowerCase());
    expect(specs.length).toBeGreaterThan(0);
    expect(JSON.stringify(specs)).toMatch(/art/);
    expect(JSON.stringify(specs)).toMatch(/can't attack/);
  });
  it('locks non-mana activated abilities of a non-creature host', () => {
    const host: any = { id: 'art', controller: 'p1', card: { name: 'Census Relic', type_line: 'Artifact', oracle_text: '{T}: Draw a card.' } };
    const aura: any = { id: 'f', controller: 'p2', attachedTo: 'art', card: { name: 'Census Fetters', type_line: 'Enchantment \u2014 Aura', oracle_text: FETTERS } };
    const state: any = { battlefield: [host, aura] };
    expect(permanentActivatedAbilitiesLockedByAttachment(host, state, false).locked).toBe(true);
    expect(permanentActivatedAbilitiesLockedByAttachment(host, state, true).locked).toBe(false);
  });
});

describe('round 29: life paid as it entered', () => {
  const text = "Trample\nAs this creature enters, pay any amount of life.\nCensus Minion's power and toughness are each equal to the life paid as it entered.";
  it('detects, caps and applies the payment', () => {
    const card: any = cda('Census Minion', text);
    expect(hasAsEntersPayAnyLife(card)).toBe(true);
    const perm: any = { id: 'm', controller: 'p1', card, asEntersLifePaymentPending: true };
    const state: any = { life: { p1: 20 }, players: [{ id: 'p1', life: 20 }], battlefield: [perm] };
    expect(getAsEntersPayAnyLifeMax(state, 'p1', card)).toBe(20);
    expect(getLifePaidOnEntryPT(perm)).toEqual({ power: 0, toughness: 1 });
    expect(applyAsEntersPayAnyLifeChoice(state, { maxValue: 20, permanentId: 'm' }, 'p1', 7)).toBe(7);
    expect(state.life.p1).toBe(13);
    expect(calculateVariablePT(card, state)).toEqual({ power: 7, toughness: 7 });
  });
  it('caps Nameless Race style payments by opposing white permanents and graveyard cards', () => {
    const card: any = cda('Census Race', "As this creature enters, pay any amount of life. The amount you pay can't be more than the total number of white nontoken permanents your opponents control plus the total number of white cards in their graveyards.");
    const state: any = { life: { p1: 20 }, battlefield: [{ id: 'w', controller: 'p2', card: { colors: ['W'] } }, { id: 't', controller: 'p2', isToken: true, card: { colors: ['W'] } }], zones: { p2: { graveyard: [{ colors: ['W'] }, { colors: ['B'] }] } } };
    expect(getAsEntersPayAnyLifeMax(state, 'p1', card)).toBe(2);
  });
});

describe('round 29: generic count CDA grammar', () => {
  it('parses the supported clauses', () => {
    expect(parseGenericCountCDA('the number of time counters on it')).toBeTruthy();
    expect(parseGenericCountCDA('1 plus twice the number of age counters on it')).toMatchObject({ base: 1, multiplier: 2 });
    expect(parseGenericCountCDA('the number of creatures named ~ on the battlefield')).toBeTruthy();
    expect(parseGenericCountCDA('the total mana value of other creatures you control')).toBeTruthy();
    expect(parseGenericCountCDA('the number of cards in your hand')).toBeNull();
  });
  it('computes counters, named creatures, opponents and graveyards', () => {
    const ooze: any = cda('Census Ooze', "Census Ooze's power and toughness are each equal to 1 plus twice the number of age counters on it.");
    expect(calculateVariablePT(ooze, { battlefield: [{ id: 'cda', controller: 'p1', card: ooze, counters: { age: 3 } }] })).toEqual({ power: 7, toughness: 7 });
    const rats: any = cda('Census Rats', "Census Rats's power and toughness are each equal to the number of creatures named Census Rats on the battlefield.");
    const bf = [{ id: 'cda', controller: 'p1', card: rats }, { id: 'r2', controller: 'p2', card: { name: 'Census Rats', type_line: 'Creature' } }];
    expect(calculateVariablePT(rats, { battlefield: bf })).toEqual({ power: 2, toughness: 2 });
    const avenger: any = cda('Census Avenger', "Census Avenger's power and toughness are each equal to 1 plus the number of artifacts your opponents control.");
    expect(calculateVariablePT(avenger, { battlefield: [{ id: 'cda', controller: 'p1', card: avenger }, { id: 'a', controller: 'p2', card: { type_line: 'Artifact' } }, { id: 'b', controller: 'p1', card: { type_line: 'Artifact' } }] })).toEqual({ power: 2, toughness: 2 });
    const det: any = cda('Census Detritus', "Census Detritus's power and toughness are each equal to the number of nonbasic land cards in your opponents' graveyards.");
    expect(calculateVariablePT(det, { battlefield: [{ id: 'cda', controller: 'p1', card: det }], zones: { p2: { graveyard: [{ type_line: 'Land' }, { type_line: 'Basic Land \u2014 Forest' }] } } })).toEqual({ power: 1, toughness: 1 });
    const anc: any = cda('Census Ancient', "Census Ancient's power and toughness are each equal to the total mana value of other creatures you control.");
    expect(calculateVariablePT(anc, { battlefield: [{ id: 'cda', controller: 'p1', card: { ...anc, cmc: 7 } }, { id: 'c', controller: 'p1', card: { type_line: 'Creature', cmc: 3 } }] })).toEqual({ power: 3, toughness: 3 });
  });
  it('classifies these census lines as handled', () => {
    const sys = (l: string, n: string) => classifyStaticCensusLine(l, n)?.system;
    expect(sys("Census Tide's power and toughness are each equal to the number of time counters on it.", 'Census Tide')).toMatch(/generic count CDA/);
    expect(sys("Census Minion's power and toughness are each equal to the life paid as it entered.", 'Census Minion')).toMatch(/life paid/);
    expect(sys('As this creature enters, pay any amount of life.', 'Census Minion')).toMatch(/pay any amount|as-enters/);
  });
});
