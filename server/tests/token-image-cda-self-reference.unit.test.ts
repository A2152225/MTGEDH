import { describe, it, expect } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { buildTokenImageSpecFromCard, lookupExactTokenPrinting } from '../src/services/tokens.js';
import { tokenAbilitiesAlign, tokenRulesTextAligns } from '../src/services/tokenImageMatch.js';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator.js';

const SMITHY_ETB = 'When Thousand Moons Smithy enters, create a white Gnome Soldier artifact creature token with "This token\'s power and toughness are each equal to the number of artifacts and/or creatures you control."';

function createSmithyToken(): any {
  const steps = (parseOracleTextToIR(SMITHY_ETB, 'Thousand Moons Smithy').abilities[0] as any).steps;
  const state: any = {
    players: [{ id: 'p1', life: 40, library: [], hand: [], graveyard: [], exile: [] }],
    battlefield: [{ id: 'smithy', controller: 'p1', owner: 'p1', card: { name: 'Thousand Moons Smithy', type_line: 'Legendary Artifact' } }],
    stack: [],
  };
  const result: any = applyOracleIRStepsToGameState(state, steps, { controllerId: 'p1', sourceId: 'smithy', sourceName: 'Thousand Moons Smithy' } as any);
  return result.state;
}

describe('token art: quoted CDA self-reference (This token\'s vs This creature\'s)', () => {
  it('folds This token\'s / curly apostrophe onto the printing\'s This creature\'s', () => {
    const printed = 'This creature\'s power and toughness are each equal to the number of artifacts and/or creatures you control.';
    const granted = 'This token\u2019s power and toughness are each equal to the number of artifacts and/or creatures you control.';
    expect(tokenAbilitiesAlign([], printed, [granted])).toBe(true);
    expect(tokenRulesTextAligns(printed, granted)).toBe(true);
    expect(tokenRulesTextAligns(printed, '')).toBe(false);
  });

  it('Thousand Moons Smithy Gnome Soldier matches Scryfall tlci/3 art', () => {
    const state = createSmithyToken();
    const token = state.battlefield.find((p: any) => p.isToken);
    expect(token?.card?.type_line).toMatch(/artifact creature/i);
    const printing = lookupExactTokenPrinting(buildTokenImageSpecFromCard(token.card));
    expect(printing?.set).toBe('tlci');
    expect(printing?.id).toBe('cbe7c36a-77b7-4418-9e2d-b6aeea61502e');
  });

  it('Gnome Soldier P/T counts artifacts and/or creatures you control once each', () => {
    const state = createSmithyToken();
    state.battlefield.push(
      { id: 'bear', controller: 'p1', owner: 'p1', card: { name: 'Bear', type_line: 'Creature \u2014 Bear', power: '2', toughness: '2' } },
      { id: 'golem', controller: 'p1', owner: 'p1', card: { name: 'Golem', type_line: 'Artifact Creature \u2014 Golem', power: '3', toughness: '3' } },
      { id: 'opp', controller: 'p2', owner: 'p2', card: { name: 'Opp Bear', type_line: 'Creature \u2014 Bear', power: '2', toughness: '2' } },
    );
    const token = state.battlefield.find((p: any) => p.isToken);
    // Smithy (artifact) + token + Bear + Golem = 4
    expect(calculateVariablePT(token.card, state)).toEqual({ power: 4, toughness: 4 });
  });
});
