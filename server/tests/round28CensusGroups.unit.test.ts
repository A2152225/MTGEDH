import { describe, it, expect } from 'vitest';
import { getGrantedScavengeCost, cardHasPrintedScavenge, oracleGrantsGraveyardScavenge } from '../src/state/modules/graveyardScavengeGrants';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator';
import { permanentRejectsAuraSpellTargets } from '../src/rules-engine/auraSpellTargetRestriction';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify';

const GRANT = 'Each creature card in your graveyard has scavenge. The scavenge cost is equal to its mana cost. (Exile a creature card from your graveyard and pay its mana cost.)';

describe('round 28 census groups', () => {
  it('grants scavenge to graveyard creature cards at their mana cost', () => {
    expect(oracleGrantsGraveyardScavenge(GRANT)).toBe(true);
    const state: any = { battlefield: [{ id: 'v', controller: 'p1', card: { name: 'Census Varolz', oracle_text: GRANT } }] };
    const beast = { name: 'Census Beast', type_line: 'Creature \u2014 Beast', mana_cost: '{3}{G}', oracle_text: '' };
    expect(getGrantedScavengeCost(state, 'p1', beast)).toBe('{3}{G}');
    expect(getGrantedScavengeCost(state, 'p2', beast)).toBeUndefined();
    expect(getGrantedScavengeCost(state, 'p1', { name: 'Census Bolt', type_line: 'Instant', mana_cost: '{R}' })).toBeUndefined();
    expect(cardHasPrintedScavenge({ oracle_text: 'Scavenge {4}{G}{G}' })).toBe(true);
    expect(cardHasPrintedScavenge(beast)).toBe(false);
  });
  it('counts cards in all players hands for the CDA', () => {
    const card: any = { id: 'm', name: 'Census Sorcerer', type_line: 'Creature', power: '*', toughness: '*', oracle_text: "Census Sorcerer's power and toughness are each equal to the total number of cards in all players' hands.", controller: 'p1' };
    const state: any = { players: [{ id: 'p1' }, { id: 'p2' }], zones: { p1: { hand: [{}, {}], handCount: 2 }, p2: { hand: [{}, {}, {}], handCount: 3 } }, battlefield: [{ id: 'm', controller: 'p1', card }] };
    expect(calculateVariablePT(card, state)).toEqual({ power: 5, toughness: 5 });
  });
  it('rejects aura spell targets', () => {
    expect(permanentRejectsAuraSpellTargets({ card: { name: 'Census Runeaxe', oracle_text: 'Vigilance\nCensus Runeaxe can\'t be the target of Aura spells.' } })).toBe(true);
    expect(permanentRejectsAuraSpellTargets({ card: { name: 'Census Bear', oracle_text: 'Vigilance' } })).toBe(false);
  });
  it('classifies the round 28 families as handled elsewhere', () => {
    const sys = (l: string, n: string) => classifyStaticCensusLine(l, n)?.system;
    expect(sys("Census Runeaxe can't be the target of Aura spells.", 'Census Runeaxe')).toMatch(/aura-spell/);
    expect(sys('Each creature card in your graveyard has scavenge. The scavenge cost is equal to its mana cost. (Exile it.)', 'Census Varolz')).toMatch(/scavenge/);
    expect(sys("Census Sorcerer's power and toughness are each equal to the total number of cards in all players' hands.", 'Census Sorcerer')).toMatch(/all hands/);
  });
});
