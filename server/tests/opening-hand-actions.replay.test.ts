import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('opening hand replay semantics', () => {
  it('replays Gemstone Caverns with a luck counter for a non-starting player', () => {
    const game = createInitialGameState('t_opening_hand_gemstone_replay');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).startingPlayerId = p1;
    (game.state as any).startingPlayer = p1;
    (game.state as any).zones = {
      [p2]: {
        hand: [
          {
            id: 'g1',
            name: 'Gemstone Caverns',
            oracle_text: "If Gemstone Caverns is in your opening hand and you're not playing first, you may begin the game with it on the battlefield with a luck counter on it.",
            type_line: 'Legendary Land',
            zone: 'hand',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };

    game.applyEvent({
      type: 'playOpeningHandCards',
      playerId: p2,
      cardIds: ['g1'],
    } as any);

    expect((game.state as any).zones?.[p2]?.handCount).toBe(0);
    const permanent = ((game.state as any).battlefield || []).find((perm: any) => perm.id === 'g1');
    expect(permanent).toBeDefined();
    expect(permanent?.counters).toEqual({ luck: 1 });
  });
});