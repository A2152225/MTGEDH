import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('option choice replay semantics', () => {
  it('replays a single chosen option from the persisted chosenOptions payload', () => {
    const game = createInitialGameState('t_option_choice_replay_single');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'adaptive_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'adaptive_card',
          name: 'Adaptive Automaton',
          type_line: 'Artifact Creature',
        },
      },
    ];

    game.applyEvent({
      type: 'optionChoice',
      playerId: p1,
      permanentId: 'adaptive_1',
      chosenOptions: ['flying'],
    } as any);

    const permanent = ((game.state as any).battlefield || [])[0];
    expect((permanent as any).chosenOption).toBe('flying');
    expect((permanent as any).chosenOptions).toBeUndefined();
  });

  it('replays multiple chosen options onto chosenOptions', () => {
    const game = createInitialGameState('t_option_choice_replay_multi');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'greymond_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'greymond_card',
          name: 'Greymond, Avacyn\'s Stalwart',
          type_line: 'Legendary Creature',
        },
      },
    ];

    game.applyEvent({
      type: 'optionChoice',
      playerId: p1,
      permanentId: 'greymond_1',
      chosenOptions: ['first strike', 'vigilance'],
    } as any);

    const permanent = ((game.state as any).battlefield || [])[0];
    expect((permanent as any).chosenOptions).toEqual(['first strike', 'vigilance']);
    expect((permanent as any).chosenOption).toBeUndefined();
  });
});