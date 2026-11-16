import { describe, it, expect } from 'vitest';
import {
  buildPreExploreScryStep,
  peekLibraryForScryStep,
  takePendingPreExploreScry,
} from '../src/state/modules/preExploreScryPrompt.js';

describe('pendingPreExploreScry consumption (Twists and Turns)', () => {
  it('takes and clears the pending count for that player only', () => {
    const state: any = { pendingPreExploreScry: { p1: 1, p2: 2 } };
    expect(takePendingPreExploreScry(state, 'p1')).toBe(1);
    expect(state.pendingPreExploreScry).toEqual({ p2: 2 });
    expect(takePendingPreExploreScry(state, 'p2')).toBe(2);
    expect(state.pendingPreExploreScry).toBeUndefined();
    expect(takePendingPreExploreScry(state, 'p1')).toBe(0);
  });

  it('peeks the top N library cards for the existing scry prompt', () => {
    const lib = [
      { id: 'c1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'f.png' } },
      { id: 'c2', name: 'Bear', type_line: 'Creature — Bear' },
    ];
    expect(peekLibraryForScryStep(lib, 1)).toEqual([
      expect.objectContaining({ id: 'c1', name: 'Forest', imageUrl: 'f.png' }),
    ]);
    expect(peekLibraryForScryStep(lib, 9)).toHaveLength(2);
    expect(peekLibraryForScryStep([], 1)).toEqual([]);
  });

  it('builds a scry step the existing prompt already renders, with an explore follow-up', () => {
    const step = buildPreExploreScryStep({
      playerId: 'p1',
      cards: [{ id: 'c1', name: 'Forest' }],
      scryCount: 1,
      exploreFollowup: { controller: 'p1', permanentId: 'bear_1', remainingPermanentIds: [] },
    });
    expect(step.type).toBe('scry');
    expect(step.mandatory).toBe(true);
    expect(step.scryCount).toBe(1);
    expect(step.scryFollowupKind).toBe('explore');
    expect(step.pendingExploreAfter).toEqual({
      controller: 'p1',
      permanentId: 'bear_1',
      remainingPermanentIds: [],
    });
    expect(String(step.description)).toMatch(/Scry 1/);
  });
});
