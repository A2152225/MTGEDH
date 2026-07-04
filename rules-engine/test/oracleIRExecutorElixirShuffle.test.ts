import { describe, expect, it } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { collectOracleEffectSteps } from '../../server/src/state/modules/trigger-runtime-wiring.js';

describe('Oracle IR Elixir shuffle move_zone', () => {
  it('shuffles source permanent and graveyard into library', () => {
    const p1 = 'p1' as PlayerID;
    const effectText = "You gain 5 life. Shuffle this permanent and your graveyard into their owner's library.";
    const steps = collectOracleEffectSteps(effectText, 'Elixir of Immortality');
    const state = {
      players: [{
        id: p1,
        hand: [],
        library: [{ id: 'lib_1', name: 'Library Card', type_line: 'Creature' }],
        graveyard: [
          { id: 'gy_1', name: 'Grave Card 1', type_line: 'Sorcery' },
          { id: 'gy_2', name: 'Grave Card 2', type_line: 'Instant' },
        ],
      }],
      battlefield: [{
        id: 'elixir_perm_1',
        controller: p1,
        card: { id: 'elixir_card_1', name: 'Elixir of Immortality', type_line: 'Artifact' },
      }],
      life: { [p1]: 40 },
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'elixir_perm_1',
      sourceName: 'Elixir of Immortality',
      sourceObjectType: 'ability',
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const nextState = result.state as GameState;

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['gain_life', 'move_zone']);
    expect(nextState.battlefield).toHaveLength(0);
    expect(nextState.players[0].graveyard).toHaveLength(0);
    expect(nextState.players[0].library?.map((card: any) => card.id).sort()).toEqual(
      ['elixir_card_1', 'gy_1', 'gy_2', 'lib_1'].sort(),
    );
  });
});
