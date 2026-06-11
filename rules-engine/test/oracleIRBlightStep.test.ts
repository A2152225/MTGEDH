import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src';
import { applyBlightStep } from '../src/oracleIRExecutorKeywordStepHandlers';
import type { OracleEffectStep } from '../src/oracleIR';

function makeCreature(id: string, controller: PlayerID) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    card: {
      id,
      name: `Creature ${id}`,
      type_line: 'Creature',
    },
  };
}

describe('applyBlightStep', () => {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;

  it('requires player choice when the blighting player controls creatures', () => {
    const step = {
      kind: 'blight',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 2 },
      raw: 'Blight 2.',
    } as Extract<OracleEffectStep, { kind: 'blight' }>;

    const result = applyBlightStep(
      {
        players: [{ id: p1 }],
        battlefield: [makeCreature('c1', p1), makeCreature('c2', p1)],
      } as any,
      step,
      {
        controllerId: p1,
        sourceName: 'Test Blight',
      } as any,
    );

    expect('message' in result).toBe(true);
    if ('message' in result) {
      expect(result.reason).toBe('player_choice_required');
    }
  });

  it('requires player choice when spell cast targets include the opponent player id', () => {
    const step = {
      kind: 'blight',
      who: { kind: 'target_opponent' },
      amount: { kind: 'number', value: 2 },
      raw: 'Target opponent blights 2.',
    } as Extract<OracleEffectStep, { kind: 'blight' }>;

    const result = applyBlightStep(
      {
        players: [{ id: p1 }, { id: p2 }],
        battlefield: [makeCreature('c1', p2)],
      } as any,
      step,
      {
        controllerId: p1,
        sourceName: 'Test Blight',
        selectorContext: {
          targetOpponentId: p2,
          targetPlayerId: p2,
          chosenObjectIds: [p2],
        },
      } as any,
    );

    expect('message' in result).toBe(true);
    if ('message' in result) {
      expect(result.reason).toBe('player_choice_required');
    }
  });

  it('applies -1/-1 counters when a target is chosen', () => {
    const step = {
      kind: 'blight',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 2 },
      raw: 'Blight 2.',
    } as Extract<OracleEffectStep, { kind: 'blight' }>;

    const result = applyBlightStep(
      {
        players: [{ id: p1 }],
        battlefield: [makeCreature('c1', p1), makeCreature('c2', p1)],
      } as any,
      step,
      {
        controllerId: p1,
        sourceName: 'Test Blight',
        selectorContext: { chosenObjectIds: ['c1'] },
      } as any,
    );

    expect('state' in result).toBe(true);
    if ('state' in result) {
      const updated = (result.state.battlefield || []).find((perm: any) => perm.id === 'c1');
      expect(updated?.counters?.['-1/-1']).toBe(2);
    }
  });
});
