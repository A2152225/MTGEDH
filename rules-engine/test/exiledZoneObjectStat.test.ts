import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

const INFERNAL_RECKONING =
  'Exile target colorless creature. You gain life equal to its power.';

describe('exiled-zone object_stat lookup', () => {
  it('parses exile then gain_life with its-power amount', () => {
    const steps = parseOracleTextToIR(INFERNAL_RECKONING, 'Infernal Reckoning').abilities[0]?.steps ?? [];
    expect(steps.map((step) => step.kind)).toEqual(['exile', 'gain_life']);
    expect(steps[1]).toMatchObject({
      kind: 'gain_life',
      amount: { kind: 'object_stat', subject: 'it', stat: 'power' },
    });
  });

  it('resolves its power from exile zone via chosenObjectIds when lastMovedCards is absent', () => {
    const steps = parseOracleTextToIR(INFERNAL_RECKONING, 'Infernal Reckoning').abilities[0]?.steps ?? [];
    const gainLifeStep = steps[1];
    const start = {
      players: [
        { id: 'p_caster', seat: 0, life: 20 },
        {
          id: 'p_opp',
          seat: 1,
          life: 20,
          exile: [
            {
              id: 'c_colorless',
              controller: 'p_opp',
              owner: 'p_opp',
              power: 4,
              card: {
                name: 'Soulless Jailer',
                type_line: 'Artifact Creature',
                power: '4',
                toughness: '1',
              },
            },
          ],
        },
      ],
      battlefield: [],
    } as any;

    const result = applyOracleIRStepsToGameState(
      start,
      [gainLifeStep],
      buildOracleIRExecutionContext(
        {
          controllerId: 'p_caster',
          selectorContext: { chosenObjectIds: ['c_colorless'] },
        },
        { chosenObjectIds: ['c_colorless'] },
      ),
      { allowOptional: true },
    );

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['gain_life']);
    expect(result.state.players.find((p: any) => p.id === 'p_caster')?.life).toBe(24);
  });

  it('runs full exile-then-life sequence with target binding only in exile after exile step', () => {
    const steps = parseOracleTextToIR(INFERNAL_RECKONING, 'Infernal Reckoning').abilities[0]?.steps ?? [];
    const start = {
      players: [
        { id: 'p_caster', seat: 0, life: 20 },
        { id: 'p_opp', seat: 1, life: 20 },
      ],
      battlefield: [
        {
          id: 'c_colorless',
          controller: 'p_opp',
          owner: 'p_opp',
          power: 6,
          card: {
            name: 'Soulless Jailer',
            type_line: 'Artifact Creature',
            power: '6',
            toughness: '1',
          },
        },
      ],
    } as any;

    const afterExile = applyOracleIRStepsToGameState(
      start,
      [steps[0]],
      buildOracleIRExecutionContext(
        {
          controllerId: 'p_caster',
          selectorContext: { chosenObjectIds: ['c_colorless'] },
        },
        { chosenObjectIds: ['c_colorless'] },
      ),
      { allowOptional: true },
    );
    expect(afterExile.state.battlefield).toHaveLength(0);

    const clearedCtx = buildOracleIRExecutionContext(
      {
        controllerId: 'p_caster',
        selectorContext: { chosenObjectIds: ['c_colorless'] },
      },
      { chosenObjectIds: ['c_colorless'] },
    );

    const afterLife = applyOracleIRStepsToGameState(
      afterExile.state,
      [steps[1]],
      clearedCtx,
      { allowOptional: true },
    );

    expect(afterLife.appliedSteps?.map((step) => step.kind)).toEqual(['gain_life']);
    expect(afterLife.state.players.find((p: any) => p.id === 'p_caster')?.life).toBe(26);
  });
});
