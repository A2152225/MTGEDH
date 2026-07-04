import { describe, expect, it } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { collectOracleEffectSteps } from '../../server/src/state/modules/trigger-runtime-wiring.js';

describe('Oracle IR Deploy to the Front create_token X', () => {
  it('creates soldier tokens equal to creatures on the battlefield', () => {
    const p1 = 'p1' as PlayerID;
    const effectText = 'Create X 1/1 white Soldier creature tokens, where X is the number of creatures on the battlefield.';
    const steps = collectOracleEffectSteps(effectText, 'Deploy to the Front');
    const state = {
      players: [{ id: p1 }, { id: 'p2' }],
      battlefield: [
        { id: 'c1', controller: p1, card: { type_line: 'Creature — Soldier' } },
        { id: 'c2', controller: p1, card: { type_line: 'Creature — Soldier' } },
        { id: 'c3', controller: 'p2', card: { type_line: 'Creature — Goblin' } },
        { id: 'c4', controller: 'p2', card: { type_line: 'Creature — Goblin' } },
        { id: 'c5', controller: 'p2', card: { type_line: 'Creature — Goblin' } },
      ],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'deploy_1',
      sourceName: 'Deploy to the Front',
      sourceObjectType: 'spell',
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const nextState = result.state as GameState;

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['create_token']);
    expect(nextState.battlefield?.filter((perm) => perm.isToken)).toHaveLength(5);
    expect(nextState.battlefield?.every((perm) => !perm.isToken || perm.controller === p1)).toBe(true);
  });
});
