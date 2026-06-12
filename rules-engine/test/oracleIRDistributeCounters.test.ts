import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { buildOracleIRExecutionContext } from '../src/oracleIRExecutorExecutionContext';
import type { GameState } from '../../shared/src';

function collectStepsFromText(text: string, name: string) {
  const ir = parseOracleTextToIR(text, name);
  return ir.abilities.flatMap((ability) => ability.steps || []);
}

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

describe('distribute counters among targets (IR execute)', () => {
  it('parses distribute clauses with distribution among metadata', () => {
    const steps = collectStepsFromText(
      'Distribute two +1/+1 counters among up to two target creatures.',
      'Court of Garenbrig',
    );
    expect(steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'add_counter',
          distribution: 'among',
          amount: { kind: 'number', value: 2 },
          counter: '+1/+1',
        }),
      ]),
    );
  });

  it('splits counters across bound target creatures when split is deterministic', () => {
    const steps = collectStepsFromText(
      'Distribute two +1/+1 counters among up to two target creatures.',
      'Court of Garenbrig',
    );
    const state = buildState(['t1', 't2']);
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p1' as PlayerID,
        selectorContext: { chosenObjectIds: ['t1', 't2'] },
      },
      { chosenObjectIds: ['t1', 't2'] },
    );

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(result.skippedSteps).toEqual([]);
    expect(result.state.battlefield?.find((perm: any) => perm.id === 't1')?.counters?.['+1/+1']).toBe(1);
    expect(result.state.battlefield?.find((perm: any) => perm.id === 't2')?.counters?.['+1/+1']).toBe(1);
  });

  it('requires player choice when counter total exceeds target count', () => {
    const steps = collectStepsFromText(
      'Distribute three +1/+1 counters among up to two target creatures.',
      'Court of Garenbrig',
    );
    const state = buildState(['t1', 't2']);
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
    expect(result.skippedSteps.some((step) => step.kind === 'add_counter')).toBe(true);
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'player_choice_required')).toBe(true);
  });

  it('applies preselected counter distribution from selector context', () => {
    const steps = collectStepsFromText(
      'Distribute three +1/+1 counters among up to two target creatures.',
      'Court of Garenbrig',
    );
    const state = buildState(['t1', 't2']);
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p1' as PlayerID,
        selectorContext: {
          chosenObjectIds: ['t1', 't2'],
          counterDistributionByTargetId: { t1: 2, t2: 1 },
        },
      },
      { chosenObjectIds: ['t1', 't2'] },
    );
    expect(ctx.selectorContext?.counterDistributionByTargetId).toEqual({ t1: 2, t2: 1 });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(result.skippedSteps).toEqual([]);
    expect(result.state.battlefield?.find((perm: any) => perm.id === 't1')?.counters?.['+1/+1']).toBe(2);
    expect(result.state.battlefield?.find((perm: any) => perm.id === 't2')?.counters?.['+1/+1']).toBe(1);
  });

  it('parses variable-amount distribute clauses with reference amounts', () => {
    const steps = collectStepsFromText(
      'Distribute a number of +1/+1 counters equal to the number of creatures you control among any number of creatures you control.',
      'Variable Distribute',
    );
    expect(steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'add_counter',
          distribution: 'among',
          counter: '+1/+1',
          amount: { kind: 'reference_amount', raw: 'the number of creatures you control' },
        }),
      ]),
    );
  });

  it('executes variable-amount distribute using battlefield creature count', () => {
    const steps = collectStepsFromText(
      'Distribute a number of +1/+1 counters equal to the number of creatures you control among any number of creatures you control.',
      'Variable Distribute',
    );
    const state = buildState(['t1', 't2', 't3']);
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p1' as PlayerID,
        selectorContext: {
          chosenObjectIds: ['t1', 't2', 't3'],
          counterDistributionByTargetId: { t1: 1, t2: 1, t3: 1 },
        },
      },
      { chosenObjectIds: ['t1', 't2', 't3'] },
    );

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(result.skippedSteps).toEqual([]);
    expect(result.state.battlefield?.find((perm: any) => perm.id === 't1')?.counters?.['+1/+1']).toBe(1);
    expect(result.state.battlefield?.find((perm: any) => perm.id === 't2')?.counters?.['+1/+1']).toBe(1);
    expect(result.state.battlefield?.find((perm: any) => perm.id === 't3')?.counters?.['+1/+1']).toBe(1);
  });

  it('parses stun counter distribute clauses', () => {
    const steps = collectStepsFromText(
      'Tap up to X target creatures, then distribute three stun counters among any number of tapped creatures your opponents control.',
      'Crashing Wave',
    );
    expect(steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'add_counter',
          distribution: 'among',
          counter: 'stun',
          amount: { kind: 'number', value: 3 },
        }),
      ]),
    );
  });

  it('sets lastMovedBattlefieldPermanentIds for double_counters follow-up', () => {
    const text =
      'Distribute three +1/+1 counters among one, two, or three target creatures, then double the number of +1/+1 counters on each of those creatures.';
    const steps = collectStepsFromText(text, 'Biogenic Upgrade');
    const state = buildState(['t1', 't2']);
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p1' as PlayerID,
        selectorContext: {
          chosenObjectIds: ['t1', 't2'],
          counterDistributionByTargetId: { t1: 2, t2: 1 },
        },
      },
      { chosenObjectIds: ['t1', 't2'] },
    );

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(result.skippedSteps).toEqual([]);
    expect(result.state.battlefield?.find((perm: any) => perm.id === 't1')?.counters?.['+1/+1']).toBe(4);
    expect(result.state.battlefield?.find((perm: any) => perm.id === 't2')?.counters?.['+1/+1']).toBe(2);
  });
});
