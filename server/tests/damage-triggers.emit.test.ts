import { describe, it, expect } from 'vitest';
import { emitPendingDamageTriggers } from '../src/socket/game-actions.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('Pending damage triggers (emission)', () => {
  it('does not emit when there are no pending triggers', () => {
    const gameId = 'game_1';
    ResolutionQueueManager.clearAllSteps(gameId);

    const emitted = emitPendingDamageTriggers(
      {} as any,
      {
        state: {
          battlefield: [],
          pendingDamageTriggers: {},
        },
      } as any,
      gameId
    );

    expect(emitted).toBe(0);
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(0);
  });

  it('enqueues one TARGET_SELECTION step per queued trigger with source image when present', () => {
    const gameId = 'game_2';
    ResolutionQueueManager.clearAllSteps(gameId);

    const game = {
      state: {
        players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
        battlefield: [
          {
            id: 'src_1',
            card: {
              name: 'Brash Taunter',
              image_uris: { small: 'https://example.com/small.jpg' },
              type_line: 'Creature — Goblin',
            },
          },
          {
            id: 'perm_1',
            controller: 'p2',
            card: {
              name: 'Grizzly Bears',
              type_line: 'Creature — Bear',
              image_uris: { small: 'https://example.com/bears.jpg' },
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

    const emitted = emitPendingDamageTriggers({} as any, game, gameId);

    expect(emitted).toBe(1);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);
    const step = queue.steps[0] as any;

    expect(step.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect(step.playerId).toBe('p1');
    expect(step.sourceId).toBe('src_1');
    expect(step.sourceName).toBe('Brash Taunter');
    expect(step.sourceImage).toBe('https://example.com/small.jpg');
    expect(step.damageReceivedTrigger).toBe(true);
    expect(step.damageTrigger?.triggerId).toBe('trig_1');
    expect(step.damageTrigger?.damageAmount).toBe(5);
    expect(Array.isArray(step.validTargets)).toBe(true);
    expect(step.validTargets.length).toBeGreaterThan(0);
  });
});
