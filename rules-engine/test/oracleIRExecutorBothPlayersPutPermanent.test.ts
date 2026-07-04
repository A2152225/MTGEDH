import { describe, expect, it } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { collectOracleEffectSteps } from '../../server/src/state/modules/trigger-runtime-wiring.js';

describe('Oracle IR both players put permanent move_zone deferral', () => {
  it('defers optional permanent-from-hand to player choice instead of auto-moving cards', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const effectText = 'You and that player may each put a permanent card from your hand onto the battlefield.';
    const steps = collectOracleEffectSteps(effectText, 'Test Source');
    const state = {
      players: [
        {
          id: p1,
          hand: [{ id: 'land1', name: 'Forest', type_line: 'Basic Land — Forest' }],
          library: [],
          graveyard: [],
        },
        {
          id: p2,
          hand: [{ id: 'land2', name: 'Island', type_line: 'Basic Land — Island' }],
          library: [],
          graveyard: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'src1',
      sourceName: 'Test Source',
      sourceObjectType: 'trigger',
      selectorContext: { targetPlayerId: p2 },
      interactivePlayerChoices: true,
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const nextState = result.state as GameState;

    expect(result.appliedSteps).toHaveLength(0);
    expect(result.skippedSteps?.map((step) => step.kind)).toEqual(['move_zone']);
    expect(nextState.battlefield).toHaveLength(0);
    expect(nextState.players[0].hand).toHaveLength(1);
    expect(nextState.players[1].hand).toHaveLength(1);
  });
});
