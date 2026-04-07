import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('cardNameChoice replay semantics', () => {
  it('replays the chosen card name onto the selected permanent', () => {
    const game = createInitialGameState('t_card_name_choice_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'needle_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'needle_card_1',
          name: 'Pithing Needle',
          type_line: 'Artifact',
        },
      },
    ];

    game.applyEvent({
      type: 'cardNameChoice',
      playerId: p1,
      permanentId: 'needle_1',
      cardName: 'Pithing Needle',
      chosenName: 'Black Lotus',
    } as any);

    expect(((game.state as any).battlefield || [])[0]?.chosenCardName).toBe('Black Lotus');
  });

  it('falls back to player and card name when replay cannot reconstruct the original permanent id', () => {
    const game = createInitialGameState('t_card_name_choice_replay_fallback');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'needle_replay_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'needle_card_1',
          name: 'Pithing Needle',
          type_line: 'Artifact',
        },
      },
    ];

    game.applyEvent({
      type: 'cardNameChoice',
      playerId: p1,
      permanentId: 'needle_live_random_id',
      cardName: 'Pithing Needle',
      chosenName: 'Sol Ring',
    } as any);

    expect(((game.state as any).battlefield || [])[0]?.chosenCardName).toBe('Sol Ring');
    expect((game.state as any).replayPermanentAliases).toEqual({
      needle_live_random_id: 'needle_replay_1',
    });
  });
});