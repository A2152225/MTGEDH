import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src';
import { applyGainControlStep } from '../src/oracleIRExecutorBattlefieldStepHandlers.js';
import { parseTriggerEffectSteps } from '../../server/src/state/modules/trigger-runtime-wiring.js';

describe('Oracle IR gain control — attacking player artifact', () => {
  it('transfers source artifact to attacking player and untaps it', () => {
    const effect = 'the attacking player gains control of this artifact and untaps it';
    const steps = parseTriggerEffectSteps(effect, 'Contested Game Ball');
    expect(steps[0]).toMatchObject({
      kind: 'gain_control',
      newController: { kind: 'target_player' },
    });

    const state = {
      battlefield: [{
        id: 'game_ball_1',
        controller: 'p2',
        owner: 'p2',
        tapped: true,
        card: { name: 'Contested Game Ball', type_line: 'Artifact' },
      }],
    } as unknown as GameState;

    const result = applyGainControlStep(
      state,
      steps[0] as Extract<typeof steps[0], { kind: 'gain_control' }>,
      {
        controllerId: 'p2',
        sourceId: 'game_ball_1',
        sourceName: 'Contested Game Ball',
        attackingPlayerId: 'p1',
      } as any,
    );

    expect(result.applied).toBe(true);
    expect((result.state as any).battlefield[0].controller).toBe('p1');
    expect((result.state as any).battlefield[0].tapped).toBe(false);
  });
});
