import { describe, expect, it } from 'vitest';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator.js';
import { matchesSelfShuffleIntoLibraryReplacementOracle } from '../src/state/modules/replacementEffectSpec.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';

const perm = (id: string, controller: string, type_line: string, colors: string[] = []) => ({ id, controller, card: { id: `${id}c`, type_line, colors } });

describe('batch 9: power-only characteristic-defining abilities', () => {
  const bf = [perm('a', 'p1', 'Creature - Elf', ['G']), perm('b', 'p1', 'Artifact Creature - Golem'), perm('c', 'p1', 'Artifact'), perm('d', 'p2', 'Creature - Orc')];
  it('Snow Villiers: power = creatures you control, toughness printed', () => {
    const card = { id: 'sv', name: 'Snow Villiers', power: '*', toughness: '3', controller: 'p1', type_line: 'Creature - Human Rebel Cleric', oracle_text: "Vigilance\nSnow Villiers's power is equal to the number of creatures you control." };
    expect(calculateVariablePT(card, { battlefield: bf, zones: {} })).toEqual({ power: 2, toughness: 3 });
  });
  it('artifacts you control and instant/sorcery cards in graveyard', () => {
    const fa = { id: 'fa', name: 'Filigree Attendant', power: '*', toughness: '3', controller: 'p1', oracle_text: "Flying\nFiligree Attendant's power is equal to the number of artifacts you control." };
    expect(calculateVariablePT(fa, { battlefield: bf, zones: {} })).toEqual({ power: 2, toughness: 3 });
    const hd = { id: 'hd', name: 'Haughty Djinn', power: '*', toughness: '4', controller: 'p1', oracle_text: "Flying\nHaughty Djinn's power is equal to the number of instant and sorcery cards in your graveyard." };
    const zones = { p1: { graveyard: [{ type_line: 'Instant' }, { type_line: 'Sorcery' }, { type_line: 'Creature - Bear' }] } };
    expect(calculateVariablePT(hd, { battlefield: [], zones })).toEqual({ power: 2, toughness: 4 });
  });
  it('does not override a printed numeric power', () => {
    const card = { id: 'x', name: 'Fixed', power: '2', toughness: '2', controller: 'p1', oracle_text: "Fixed's power is equal to the number of creatures you control." };
    expect(calculateVariablePT(card, { battlefield: bf, zones: {} })).toBeUndefined();
  });
  it('Revenant counts creature cards only, not all graveyard cards', () => {
    const rev = { id: 'r', name: 'Revenant', power: '*', toughness: '*', controller: 'p1', oracle_text: "Flying\nRevenant's power and toughness are each equal to the number of creature cards in your graveyard." };
    const zones = { p1: { graveyard: [{ type_line: 'Creature - Bear' }, { type_line: 'Instant' }, { type_line: 'Land' }] } };
    expect(calculateVariablePT(rev, { battlefield: [], zones })).toEqual({ power: 1, toughness: 1 });
  });
});

describe('batch 9: census readers', () => {
  it('self shuffle replacement is recognized by the real matcher', () => {
    expect(matchesSelfShuffleIntoLibraryReplacementOracle("If Darksteel Colossus would be put into a graveyard from anywhere, reveal Darksteel Colossus and shuffle it into its owner's library instead.")).toBe(true);
  });
  it('classifier routes the Batch 9 families to their readers', () => {
    expect(String(classifyStaticCensusLine("Snow Villiers's power is equal to the number of creatures you control.", "Snow Villiers")?.system)).toMatch(/variablePowerOnlyCalculator/);
    expect(String(classifyStaticCensusLine("Revenant's power and toughness are each equal to the number of creature cards in your graveyard.", "Revenant")?.system)).toMatch(/variablePTCalculator/);
    expect(String(classifyStaticCensusLine("If Darksteel Colossus would be put into a graveyard from anywhere, reveal Darksteel Colossus and shuffle it into its owner's library instead.", "Darksteel Colossus")?.system)).toMatch(/replacementEffectSpec/);
  });
});