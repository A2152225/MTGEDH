import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { buildOracleIRExecutionContext } from '../src/oracleIRExecutorExecutionContext';
import type { GameState } from '../../shared/src';

const crashingWaveText =
  'Tap up to X target creatures, then distribute three stun counters among any number of tapped creatures your opponents control.';

function buildOpponentTappedState(): GameState {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  return {
    players: [
      { id: p1, name: 'P1', life: 40 },
      { id: p2, name: 'P2', life: 40 },
    ],
    battlefield: [
      {
        id: 'opp1',
        controller: p2,
        owner: p2,
        tapped: true,
        type_line: 'Creature — Human',
        card: { name: 'Blocker', type_line: 'Creature — Human' },
        counters: {},
      },
      {
        id: 'opp2',
        controller: p2,
        owner: p2,
        tapped: true,
        type_line: 'Creature — Human',
        card: { name: 'Blocker 2', type_line: 'Creature — Human' },
        counters: {},
      },
    ],
    life: { [p1]: 40, [p2]: 40 },
    turnPlayer: p1,
    turnNumber: 1,
    phase: 'main1',
    active: true,
  } as GameState;
}

describe('Oracle IR gap batch 231 support', () => {
  it('executes stun counter distribute among tapped opponent creatures when split is deterministic', () => {
    const distributeStep = parseOracleTextToIR(crashingWaveText, 'Crashing Wave')
      .abilities.flatMap((ability) => ability.steps)
      .find((step) => step.kind === 'add_counter');
    expect(distributeStep).toMatchObject({
      kind: 'add_counter',
      counter: 'stun',
      distribution: 'among',
      amount: { kind: 'number', value: 3 },
    });

    const state = {
      ...buildOpponentTappedState(),
      battlefield: [
        ...(buildOpponentTappedState().battlefield || []),
        {
          id: 'opp3',
          controller: 'p2' as PlayerID,
          owner: 'p2' as PlayerID,
          tapped: true,
          type_line: 'Creature — Human',
          card: { name: 'Blocker 3', type_line: 'Creature — Human' },
          counters: {},
        },
      ],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID });
    const result = applyOracleIRStepsToGameState(state, [distributeStep!], ctx, { allowOptional: true });

    expect(result.skippedSteps).toEqual([]);
    expect(result.state.battlefield?.find((perm: any) => perm.id === 'opp1')?.counters?.stun).toBe(1);
    expect(result.state.battlefield?.find((perm: any) => perm.id === 'opp2')?.counters?.stun).toBe(1);
    expect(result.state.battlefield?.find((perm: any) => perm.id === 'opp3')?.counters?.stun).toBe(1);
  });

  it('requires player choice when stun counters exceed tapped opponent creature count', () => {
    const distributeStep = parseOracleTextToIR(crashingWaveText, 'Crashing Wave')
      .abilities.flatMap((ability) => ability.steps)
      .find((step) => step.kind === 'add_counter');
    const state = buildOpponentTappedState();
    const ctx = buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID });

    const result = applyOracleIRStepsToGameState(state, [distributeStep!], ctx, {
      allowOptional: true,
      haltOnPlayerChoiceRequired: true,
    });

    expect(result.appliedSteps).toHaveLength(0);
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'player_choice_required')).toBe(true);
    expect(result.automationGaps.some((gap) => gap.metadata?.distributionCounterName === 'stun')).toBe(true);
  });

  it('applies preselected stun counter distribution on tapped opponent creatures', () => {
    const distributeStep = parseOracleTextToIR(crashingWaveText, 'Crashing Wave')
      .abilities.flatMap((ability) => ability.steps)
      .find((step) => step.kind === 'add_counter');
    const state = buildOpponentTappedState();
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p1' as PlayerID,
        selectorContext: {
          chosenObjectIds: ['opp1', 'opp2'],
          counterDistributionByTargetId: { opp1: 2, opp2: 1 },
        },
      },
      { chosenObjectIds: ['opp1', 'opp2'] },
    );

    const result = applyOracleIRStepsToGameState(state, [distributeStep!], ctx, { allowOptional: true });
    expect(result.skippedSteps).toEqual([]);
    expect(result.state.battlefield?.find((perm: any) => perm.id === 'opp1')?.counters?.stun).toBe(2);
    expect(result.state.battlefield?.find((perm: any) => perm.id === 'opp2')?.counters?.stun).toBe(1);
  });
});
