import { describe, it, expect } from 'vitest';
import { emitPendingDamageTriggers } from '../src/socket/game-actions.js';

describe('Pending damage triggers (emission)', () => {
  it('does not emit when there are no pending triggers', () => {
    const emittedTo: any[] = [];

    const emitted = emitPendingDamageTriggers(
      {} as any,
      {
        state: {
          battlefield: [],
          pendingDamageTriggers: {},
        },
      } as any,
      'game_1',
      (_io, playerId, event, payload) => {
        emittedTo.push({ playerId, event, payload });
      }
    );

    expect(emitted).toBe(0);
    expect(emittedTo.length).toBe(0);
  });

  it('emits one prompt per queued trigger with source image when present', () => {
    const emittedTo: any[] = [];

    const game = {
      state: {
        battlefield: [
          {
            id: 'src_1',
            card: {
              name: 'Brash Taunter',
              image_uris: { small: 'https://example.com/small.jpg' },
            },
          },
        ],
        pendingDamageTriggers: {
          trig_1: {
            sourceId: 'src_1',
            sourceName: 'Brash Taunter',
            controller: 'p1',
            damageAmount: 5,
            targetType: 'any',
            targetRestriction: 'any target',
          },
        },
      },
    } as any;

    const emitted = emitPendingDamageTriggers({} as any, game, 'game_2', (_io, playerId, event, payload) => {
      emittedTo.push({ playerId, event, payload });
    });

    expect(emitted).toBe(1);
    expect(emittedTo.length).toBe(1);

    expect(emittedTo[0].playerId).toBe('p1');
    expect(emittedTo[0].event).toBe('damageTriggerTargetRequest');
    expect(emittedTo[0].payload.gameId).toBe('game_2');
    expect(emittedTo[0].payload.triggerId).toBe('trig_1');
    expect(emittedTo[0].payload.source).toEqual({
      id: 'src_1',
      name: 'Brash Taunter',
      imageUrl: 'https://example.com/small.jpg',
    });
    expect(emittedTo[0].payload.damageAmount).toBe(5);
  });
});
