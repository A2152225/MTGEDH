import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

const BEAST_WITHIN_TEXT =
  'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.';

function makeFourPlayerState() {
  return {
    players: [
      { id: 'p_caster', name: 'Caster', seat: 0 },
      { id: 'p_victim', name: 'Victim', seat: 1 },
      { id: 'p_other1', name: 'Other1', seat: 2 },
      { id: 'p_other2', name: 'Other2', seat: 3 },
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
    zones: {
      p_caster: { hand: [], graveyard: [], exile: [] },
      p_victim: { hand: [], graveyard: [], exile: [] },
      p_other1: { hand: [], graveyard: [], exile: [] },
      p_other2: { hand: [], graveyard: [], exile: [] },
    },
  } as any;
}

describe('Beast Within its-controller token rider', () => {
  it('parses the token rider for the destroyed permanent controller', () => {
    const ir = parseOracleTextToIR(BEAST_WITHIN_TEXT, 'Beast Within');
    const steps = ir.abilities[0]?.steps ?? [];

    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({
      kind: 'create_token',
      who: { kind: 'controller_of_referenced_object' },
      token: '3/3 green Beast',
    });
  });

  it('creates the Beast token for the targeted permanent controller in multiplayer', () => {
    const ir = parseOracleTextToIR(BEAST_WITHIN_TEXT, 'Beast Within');
    const steps = ir.abilities[0]?.steps ?? [];
    const start = makeFourPlayerState();

    const result = applyOracleIRStepsToGameState(start, steps, buildOracleIRExecutionContext({
      controllerId: 'p_caster',
      sourceName: 'Beast Within',
      sourceObjectType: 'spell',
      selectorContext: { chosenObjectIds: ['perm_creature'] },
    }, {
      chosenObjectIds: ['perm_creature'],
      sourceObjectType: 'spell',
    }), { allowOptional: true });

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['destroy', 'create_token']);
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).some((perm: any) => perm.controller === 'p_victim' && perm.card?.name === 'Beast')).toBe(true);
    expect((result.state.battlefield || []).some((perm: any) => perm.id === 'perm_creature')).toBe(false);
  });
});
