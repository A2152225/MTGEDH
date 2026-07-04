import { describe, expect, it } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { collectOracleEffectSteps } from '../../server/src/state/modules/trigger-runtime-wiring.js';

describe('Oracle IR Darien optional create_token reference_amount', () => {
  it('creates soldier tokens equal to referenceAmount from dealt damage', () => {
    const p2 = 'p2' as PlayerID;
    const effectText = 'You may create that many 1/1 white Soldier creature tokens.';
    const steps = collectOracleEffectSteps(effectText, 'Darien, King of Kjeldor');
    const state = {
      players: [{ id: p2, hand: [], library: [], graveyard: [] }],
      battlefield: [],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p2,
      sourceId: 'darien_1',
      sourceName: 'Darien, King of Kjeldor',
      sourceObjectType: 'trigger',
      referenceAmount: 6,
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const nextState = result.state as GameState;

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['create_token']);
    expect(nextState.battlefield).toHaveLength(6);
    expect(nextState.battlefield?.every((perm) => perm.card?.name === 'Soldier')).toBe(true);
    expect(nextState.battlefield?.every((perm) => perm.controller === p2)).toBe(true);
  });
});
