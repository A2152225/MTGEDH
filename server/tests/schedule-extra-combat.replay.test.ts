import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';

describe('scheduleExtraCombat replay', () => {
  it('restores the extra combat from the event', () => {
    const game = createInitialGameState('schedule-extra-combat-replay');
    game.replay([
      { type: 'scheduleExtraCombat', source: 'Balthier and Fran', untapAttackers: false },
    ]);
    const extra = (game.state as any).extraCombats;
    expect(extra).toHaveLength(1);
    expect(extra[0].source).toBe('Balthier and Fran');
    expect(extra[0].untapAttackers).toBe(false);
  });
});
