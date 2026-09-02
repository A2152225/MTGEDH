import { describe, expect, it } from 'vitest';

import { pauseHumanPriorityAfterRestore } from '../src/gameRestoreState.js';

describe('pauseHumanPriorityAfterRestore', () => {
  it('pauses auto-pass for a human priority holder after event-log restore', () => {
    const game = {
      state: {
        priority: 'p_human',
        turnPlayer: 'p_human',
        players: [
          { id: 'p_human', name: 'King', isAI: false },
          { id: 'p_ai', name: 'Bot', isAI: true },
        ],
      },
    };

    pauseHumanPriorityAfterRestore(game);

    expect((game.state as any)._pauseHumanAutoPassUntilActionFor).toBe('p_human');
  });

  it('does not pause an AI priority holder', () => {
    const game = {
      state: {
        priority: 'p_ai',
        turnPlayer: 'p_ai',
        players: [
          { id: 'p_human', name: 'King', isAI: false },
          { id: 'p_ai', name: 'Bot', isAI: true },
        ],
      },
    };

    pauseHumanPriorityAfterRestore(game);

    expect((game.state as any)._pauseHumanAutoPassUntilActionFor).toBeUndefined();
  });

  it('does not pause an eliminated human', () => {
    const game = {
      state: {
        priority: 'p_human',
        turnPlayer: 'p_human',
        players: [
          { id: 'p_human', name: 'King', isAI: false, hasLost: true, lossReason: 'Drew from empty library' },
        ],
      },
    };

    pauseHumanPriorityAfterRestore(game);

    expect((game.state as any)._pauseHumanAutoPassUntilActionFor).toBeUndefined();
  });
});
