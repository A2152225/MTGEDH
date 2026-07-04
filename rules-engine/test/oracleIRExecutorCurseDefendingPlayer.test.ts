import { describe, expect, it } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { collectOracleEffectSteps } from '../../server/src/state/modules/trigger-runtime-wiring.js';

describe('Oracle IR curse defending player create_token', () => {
  it('creates a curse token enchantment attached to the defending player', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const effectText = 'Curse defending player';
    const steps = collectOracleEffectSteps(effectText, 'Curse Source');
    const state = {
      players: [{ id: p1, hand: [], library: [], graveyard: [] }],
      battlefield: [],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'curse_source_1',
      sourceName: 'Curse Source',
      sourceObjectType: 'trigger',
      selectorContext: { targetPlayerId: p2 },
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const nextState = result.state as GameState;

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['create_token']);
    expect(nextState.battlefield).toHaveLength(1);
    expect(nextState.battlefield?.[0]).toMatchObject({
      controller: p1,
      enchantedPlayerId: p2,
      attachedTo: p2,
      isToken: true,
      card: { name: 'Curse' },
    });
    expect(String(nextState.battlefield?.[0]?.id || '')).toMatch(/^curse_token_/);
  });
});
