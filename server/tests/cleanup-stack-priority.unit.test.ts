/**
 * Rule 514.3: cleanup with a non-empty stack must grant priority, not park with priority=null.
 */
import { describe, expect, it } from 'vitest';
import { runTurnStepCleanup } from '../src/state/modules/turn-handlers/turnStepCleanup.js';

function makeCtx(overrides: Record<string, unknown> = {}) {
  const state: any = {
    turnPlayer: 'p1',
    priority: null,
    turnNumber: 3,
    phase: 'ending',
    step: 'CLEANUP',
    stack: [
      {
        id: 'trig1',
        type: 'triggered_ability',
        controller: 'p1',
        sourceName: 'Syr Konrad, the Grim',
        effect: 'Syr Konrad deals 1 damage to each opponent.',
      },
    ],
    players: [
      { id: 'p1', life: 40 },
      { id: 'p2', life: 40 },
    ],
    battlefield: [],
    zones: {
      p1: { hand: [], handCount: 0, graveyard: [], library: [] },
      p2: { hand: [], handCount: 0, graveyard: [], library: [] },
    },
    ...overrides,
  };
  let seq = 1;
  return {
    state,
    gameId: 'cleanup_stack_priority',
    bumpSeq: () => {
      seq += 1;
    },
    get seq() {
      return seq;
    },
  } as any;
}

describe('cleanup stack priority (Rule 514.3)', () => {
  it('grants priority to the turn player when cleanup waits on a non-empty stack', () => {
    const ctx = makeCtx();
    const result = runTurnStepCleanup(ctx, false);
    expect(result.shouldCallNextTurn).toBe(false);
    expect(ctx.state.priority).toBe('p1');
    expect(ctx.state.stack).toHaveLength(1);
  });

  it('does not invent priority when replaying', () => {
    const ctx = makeCtx();
    const result = runTurnStepCleanup(ctx, true);
    // Replay path keeps historical auto-advance behavior for nonempty stack.
    expect(result.shouldCallNextTurn).toBe(true);
  });
});
