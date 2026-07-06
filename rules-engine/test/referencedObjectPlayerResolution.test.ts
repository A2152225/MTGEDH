import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { resolvePlayers } from '../src/oracleIRExecutorPlayerUtils';

function makeFourPlayerState() {
  return {
    players: [
      { id: 'p_caster', name: 'Caster', seat: 0, hand: [], library: [{ id: 'lib1' }, { id: 'lib2' }], graveyard: [] },
      { id: 'p_victim', name: 'Victim', seat: 1, hand: [], library: [{ id: 'lib3' }], graveyard: [] },
      { id: 'p_other1', name: 'Other1', seat: 2, hand: [], library: [], graveyard: [] },
      { id: 'p_other2', name: 'Other2', seat: 3, hand: [], library: [], graveyard: [] },
    ],
    battlefield: [
      {
        id: 'perm_creature',
        controller: 'p_victim',
        owner: 'p_victim',
        card: {
          id: 'card1',
          name: 'My Creature',
          type_line: 'Creature',
          power: '2',
          toughness: '2',
        },
      },
    ],
  } as any;
}

describe('referenced object player resolution', () => {
  it('parses its controller as controller_of_referenced_object', () => {
    const ir = parseOracleTextToIR(
      'Target creature gets -2/-2 until end of turn. Its controller draws a card.',
      'Test Spell'
    );
    expect(ir.abilities[0]?.steps?.[1]).toMatchObject({
      kind: 'draw',
      who: { kind: 'controller_of_referenced_object' },
    });
  });

  it('resolves its controller from a targeted on-battlefield permanent in multiplayer', () => {
    const state = makeFourPlayerState();
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p_caster',
        selectorContext: { chosenObjectIds: ['perm_creature'] },
      },
      { chosenObjectIds: ['perm_creature'] }
    );

    const players = resolvePlayers(state, { kind: 'controller_of_referenced_object' }, ctx);
    expect(players).toEqual(['p_victim']);
  });

  it('draws for the targeted permanent controller without guessing a lone opponent', () => {
    const text = 'Target creature gets -2/-2 until end of turn. Its controller draws a card.';
    const ir = parseOracleTextToIR(text, 'Test Spell');
    const steps = ir.abilities[0]?.steps ?? [];
    const start = makeFourPlayerState();
    const victimLibraryBefore = start.players[1].library.length;

    const result = applyOracleIRStepsToGameState(
      start,
      steps,
      buildOracleIRExecutionContext(
        {
          controllerId: 'p_caster',
          selectorContext: { chosenObjectIds: ['perm_creature'] },
        },
        { chosenObjectIds: ['perm_creature'] }
      ),
      { allowOptional: true }
    );

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['modify_pt', 'draw']);
    expect(result.state.players[1].hand.length).toBe(1);
    expect(result.state.players[1].library.length).toBe(victimLibraryBefore - 1);
    expect(result.state.players[0].hand.length).toBe(0);
  });
});
