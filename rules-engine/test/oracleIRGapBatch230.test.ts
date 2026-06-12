import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { buildOracleIRExecutionContext } from '../src/oracleIRExecutorExecutionContext';
import type { GameState, PlayerID } from '../../shared/src';

function buildState(targetIds: readonly string[]): GameState {
  const playerId = 'p1' as PlayerID;
  return {
    players: [{ id: playerId, name: 'Player', life: 40 }],
    battlefield: targetIds.map((id, index) => ({
      id,
      controller: playerId,
      owner: playerId,
      type_line: 'Creature — Test',
      card: { name: `Creature ${index + 1}`, type_line: 'Creature — Test' },
      counters: {},
    })),
    life: { [playerId]: 40 },
    turnPlayer: playerId,
    turnNumber: 1,
    phase: 'main1',
    active: true,
  } as GameState;
}

describe('Oracle IR gap batch 230 support', () => {
  it('parses variable-amount distribute among capped targets', () => {
    const text =
      'Distribute a number of +1/+1 counters equal to the number of creatures you control among up to two target creatures.';
    const ir = parseOracleTextToIR(text, 'Variable Distribute');
    const step = ir.abilities.flatMap((ability) => ability.steps).find((entry) => entry.kind === 'add_counter');
    expect(step).toMatchObject({
      kind: 'add_counter',
      distribution: 'among',
      counter: '+1/+1',
      amount: { kind: 'reference_amount', raw: 'the number of creatures you control' },
    });
  });

  it('requires player choice when reference amount exceeds bound target count', () => {
    const text =
      'Distribute a number of +1/+1 counters equal to the number of creatures you control among up to two target creatures.';
    const steps = parseOracleTextToIR(text, 'Variable Distribute').abilities.flatMap((ability) => ability.steps);
    const state = buildState(['t1', 't2', 't3', 't4']);
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p1' as PlayerID,
        selectorContext: { chosenObjectIds: ['t1', 't2'] },
      },
      { chosenObjectIds: ['t1', 't2'] },
    );

    const result = applyOracleIRStepsToGameState(state, steps, ctx, {
      allowOptional: true,
      haltOnPlayerChoiceRequired: true,
    });

    expect(result.appliedSteps).toHaveLength(0);
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'player_choice_required')).toBe(true);
    expect(
      result.automationGaps.some(
        (gap) => gap.metadata?.distributionTotalAmount === 4 && Array.isArray(gap.metadata?.distributionTargetIds),
      ),
    ).toBe(true);
  });
});
