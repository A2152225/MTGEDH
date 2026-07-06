import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

const LUMINATE_TEXT =
  "For each opponent, exile up to one target creature that player controls and that player gains life equal to its power.";

function makeFourPlayerState() {
  return {
    players: [
      { id: 'p_caster', seat: 0, life: 40 },
      { id: 'p_victim', seat: 1, life: 40 },
      { id: 'p_other1', seat: 2, life: 40 },
      { id: 'p_other2', seat: 3, life: 40 },
    ],
    battlefield: [
      {
        id: 'perm_v1',
        controller: 'p_victim',
        owner: 'p_victim',
        power: 5,
        card: { name: 'Victim Creature', type_line: 'Creature', power: '5', toughness: '5' },
      },
      {
        id: 'perm_o1',
        controller: 'p_other1',
        owner: 'p_other1',
        power: 3,
        card: { name: 'Other Creature', type_line: 'Creature', power: '3', toughness: '3' },
      },
    ],
  } as any;
}

describe('for-each opponent exile + referenced life rider', () => {
  it('parses Luminate Primordial into exile then gain_life steps', () => {
    const steps = parseOracleTextToIR(LUMINATE_TEXT, 'Luminate Primordial').abilities[0]?.steps ?? [];
    expect(steps.map((step) => step.kind)).toEqual(['exile', 'gain_life']);
    expect(steps[1]).toMatchObject({
      kind: 'gain_life',
      who: { kind: 'target_player' },
      amount: { kind: 'object_stat', subject: 'it', stat: 'power' },
    });
  });

  it('exiles one creature per opponent and grants life equal to each exiled power', () => {
    const steps = parseOracleTextToIR(LUMINATE_TEXT, 'Luminate Primordial').abilities[0]?.steps ?? [];
    const start = makeFourPlayerState();
    const result = applyOracleIRStepsToGameState(
      start,
      steps,
      buildOracleIRExecutionContext(
        {
          controllerId: 'p_caster',
          selectorContext: {
            chosenObjectIds: ['perm_v1', 'perm_o1'],
          },
        },
        { chosenObjectIds: ['perm_v1', 'perm_o1'] },
      ),
      { allowOptional: true },
    );

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['exile', 'gain_life']);
    expect(result.state.battlefield).toHaveLength(0);
    expect(result.state.players.find((p: any) => p.id === 'p_victim')?.life).toBe(45);
    expect(result.state.players.find((p: any) => p.id === 'p_other1')?.life).toBe(43);
    expect(result.state.players.find((p: any) => p.id === 'p_caster')?.life).toBe(40);
  });
});
