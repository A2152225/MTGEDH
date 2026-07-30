import { beforeEach, describe, expect, it } from 'vitest';

import { applyEvent } from '../src/state/modules/applyEvent.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('randomPileSacrificeResolved replay', () => {
  const gameId = 'random_pile_sacrifice_replay';

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('clears the resolved pile prompt and advances the RNG cursor without re-sacrificing', () => {
    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TWO_PILE_SPLIT,
      playerId: 'p1',
      description: 'Separate piles',
      mandatory: true,
      pileCount: 3,
      items: [],
    } as any);

    let rngCalls = 0;
    const ctx: any = {
      gameId,
      rng: () => {
        rngCalls += 1;
        return 0.25;
      },
      state: {
        players: [
          { id: 'p1', name: 'P1', spectator: false, life: 40 },
          { id: 'p2', name: 'P2', spectator: false, life: 40 },
        ],
        battlefield: [
          {
            id: 'keep_me',
            owner: 'p1',
            controller: 'p1',
            counters: {},
            card: { id: 'keep_me', name: 'Keeper', type_line: 'Artifact' },
          },
        ],
        zones: {},
        stack: [],
      },
      bumpSeq: () => undefined,
    };

    applyEvent(ctx, {
      type: 'randomPileSacrificeResolved',
      playerOrder: ['p1', 'p2'],
      randomPileByPlayer: { p1: 0, p2: 1 },
      sacrificedIds: [],
      resolvedStepId: step.id,
    } as any);

    expect(rngCalls).toBe(2);
    expect(ctx.state.battlefield.map((perm: any) => perm.id)).toEqual(['keep_me']);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => entry.id === step.id)).toBe(false);
  });
});
