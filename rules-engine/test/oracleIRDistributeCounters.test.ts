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

  it('splits counters across bound target creatures', () => {
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

  it('sets lastMovedBattlefieldPermanentIds for double_counters follow-up', () => {
    const text =
      'Distribute three +1/+1 counters among one, two, or three target creatures, then double the number of +1/+1 counters on each of those creatures.';
    const steps = collectStepsFromText(text, 'Biogenic Upgrade');
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
    expect(result.state.battlefield?.find((perm: any) => perm.id === 't1')?.counters?.['+1/+1']).toBe(4);
    expect(result.state.battlefield?.find((perm: any) => perm.id === 't2')?.counters?.['+1/+1']).toBe(2);
  });
});
