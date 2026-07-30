import { beforeEach, describe, expect, it } from 'vitest';

import { applyEvent } from '../src/state/modules/applyEvent.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('libraryChaosExchangeResolved replay', () => {
  const gameId = 'library_chaos_exchange_replay';

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('restores libraries/exile and advances RNG without double-applying live zone helpers', () => {
    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: 'p1',
      description: 'Choose targets',
      mandatory: true,
      validTargets: [],
      minTargets: 1,
      maxTargets: 1,
    } as any);

    let rngCalls = 0;
    const ctx: any = {
      gameId,
      libraries: new Map([['p1', [{ id: 'old', name: 'Old', type_line: 'Artifact' }]]]),
      rng: () => {
        rngCalls += 1;
        return 0.4;
      },
      state: {
        players: [{ id: 'p1', name: 'P1' }],
        battlefield: [{
          id: 'removed',
          owner: 'p1',
          controller: 'p1',
          card: { id: 'removed', name: 'Removed', type_line: 'Artifact' },
        }],
        zones: {
          p1: { library: [], libraryCount: 0, exile: [], exileCount: 0 },
        },
        stack: [],
      },
      bumpSeq: () => undefined,
    };

    applyEvent(ctx, {
      type: 'libraryChaosExchangeResolved',
      resolvedStepId: step.id,
      removedPermanents: [{ id: 'removed', owner: 'p1', controller: 'p1' }],
      librarySnapshots: {
        p1: [{ id: 'rest', name: 'Rest', type_line: 'Land', zone: 'library' }],
      },
      exileAddedByPlayer: {
        p1: [{ id: 'hit', name: 'Hit', type_line: 'Instant', zone: 'exile' }],
      },
      battlefieldAdded: [],
      rngDrawCount: 2,
    } as any);

    expect(ctx.state.battlefield).toEqual([]);
    expect(ctx.state.zones.p1.library.map((card: any) => card.id)).toEqual(['rest']);
    expect(ctx.state.zones.p1.exile.map((card: any) => card.id)).toEqual(['hit']);
    expect(rngCalls).toBe(2);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => entry.id === step.id)).toBe(false);
  });
});
