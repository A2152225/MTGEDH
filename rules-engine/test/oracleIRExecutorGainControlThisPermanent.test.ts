import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src';
import { applyGainControlStep } from '../src/oracleIRExecutorBattlefieldStepHandlers.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { resolvePlayers } from '../src/oracleIRExecutorPlayerUtils.js';

const HUMBLE_TEXT =
  '{T}: Draw two cards. Target opponent gains control of Humble Defector. Activate only during your turn.';

function humbleState(players: readonly string[], extraBattlefield: readonly any[] = []): GameState {
  return {
    players: players.map((id) => ({ id, name: id })),
    battlefield: [
      {
        id: 'humble_1',
        controller: 'p1',
        owner: 'p1',
        tapped: true,
        card: { name: 'Humble Defector', type_line: 'Creature — Human Rogue' },
      },
      ...extraBattlefield,
    ],
  } as unknown as GameState;
}

function humbleGainControlStep() {
  const ir = parseOracleTextToIR(HUMBLE_TEXT, 'Humble Defector');
  const gainControl = ir.abilities[0]?.steps?.find((step) => step.kind === 'gain_control');
  if (!gainControl || gainControl.kind !== 'gain_control') {
    throw new Error('expected Humble Defector gain_control step');
  }
  return gainControl;
}

describe('Oracle IR gain control of this permanent (Humble Defector)', () => {
  it('sends the source permanent to the targeted opponent, not a bound creature', () => {
    const step = humbleGainControlStep();
    expect(step).toMatchObject({
      what: { kind: 'raw', text: 'this permanent' },
      newController: { kind: 'target_opponent' },
    });

    const result = applyGainControlStep(humbleState(['p1', 'p2', 'p3']), step, {
      controllerId: 'p1',
      sourceId: 'humble_1',
      sourceName: 'Humble Defector',
      selectorContext: {
        targetOpponentId: 'p3',
        chosenObjectIds: ['p3'],
      },
    } as any);

    expect(result.applied).toBe(true);
    const humble = (result.state as any).battlefield.find((perm: any) => perm.id === 'humble_1');
    expect(humble?.controller).toBe('p3');
  });

  it('does not treat the source creature as the recipient when it is bound as a target', () => {
    const step = humbleGainControlStep();
    const result = applyGainControlStep(humbleState(['p1', 'p2']), step, {
      controllerId: 'p1',
      sourceId: 'humble_1',
      sourceName: 'Humble Defector',
      targetPermanentId: 'humble_1',
      targetCreatureId: 'humble_1',
      targetPlayerId: 'p1',
      selectorContext: {
        targetPermanentId: 'humble_1',
        targetCreatureId: 'humble_1',
        targetPlayerId: 'p1',
        chosenObjectIds: ['humble_1'],
      },
    } as any);

    expect(result.applied).toBe(true);
    const humble = (result.state as any).battlefield.find((perm: any) => perm.id === 'humble_1');
    expect(humble?.controller).toBe('p2');
  });

  it('does not auto-pick the activator when several opponents are unbound', () => {
    const step = humbleGainControlStep();
    const result = applyGainControlStep(humbleState(['p1', 'p2', 'p3']), step, {
      controllerId: 'p1',
      sourceId: 'humble_1',
      sourceName: 'Humble Defector',
    } as any);

    expect(result.applied).toBe(false);
    expect(resolvePlayers(humbleState(['p1', 'p2', 'p3']), { kind: 'target_opponent' }, {
      controllerId: 'p1',
    } as any)).toEqual([]);
  });
});
