import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';

describe('deal_damage to bound "target"', () => {
  it('applies 1 damage to a bound player from truncated "deals 1 damage to target" text', () => {
    const ir = parseOracleTextToIR('deals 1 damage to target.', 'Test Source');
    const steps = (ir.abilities || []).flatMap((ability) => ability.steps || []);
    expect(steps.map((step) => step.kind)).toEqual(['deal_damage']);

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const start = {
      players: [
        { id: p1, name: 'P1', life: 40 },
        { id: p2, name: 'P2', life: 40 },
      ],
      life: { [p1]: 40, [p2]: 40 },
      battlefield: [],
    } as unknown as GameState;

    const result = applyOracleIRStepsToGameState(
      start,
      steps,
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceName: 'Test Source',
        targetPlayerId: p2,
        selectorContext: { targetPlayerId: p2, targetOpponentId: p2 },
      } as any),
    );

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['deal_damage']);
    expect(result.skippedSteps).toEqual([]);
    expect((result.state as any).life[p2]).toBe(39);
    expect(result.state.players.find((player) => player.id === p2)?.life).toBe(39);
  });
});
