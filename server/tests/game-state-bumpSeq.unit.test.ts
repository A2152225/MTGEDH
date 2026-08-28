import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';

describe('game.bumpSeq', () => {
  it('increments seq even if ctx.bumpSeq is rebound to game.bumpSeq', () => {
    const game = createInitialGameState('t_bumpseq_cycle');
    const ctx = (game as any).ctx;
    expect(ctx).toBeTruthy();
    expect(typeof ctx.bumpSeq).toBe('function');

    const before = game.seq;
    ctx.bumpSeq = game.bumpSeq.bind(game);

    expect(() => game.bumpSeq()).not.toThrow();
    expect(game.seq).toBe(before + 1);
    expect(() => ctx.bumpSeq()).not.toThrow();
    expect(game.seq).toBe(before + 2);
  });
});
