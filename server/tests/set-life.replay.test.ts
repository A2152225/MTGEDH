import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('setLife replay semantics', () => {
  it('replays live setLife events that persist the absolute total as newLife', () => {
    const game = createInitialGameState('t_set_life_replay');
    const p1 = 'p1' as PlayerID;

    addPlayer(game, p1, 'P1');
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game as any).life = (game.state as any).life;

    game.applyEvent({
      type: 'setLife',
      playerId: p1,
      oldLife: 40,
      newLife: 17,
      by: p1,
    } as any);

    expect((game.state as any).life?.[p1]).toBe(17);
    expect((game as any).life?.[p1]).toBe(17);
    expect((game.state as any).lifeLostThisTurn?.[p1]).toBe(23);
  });
});