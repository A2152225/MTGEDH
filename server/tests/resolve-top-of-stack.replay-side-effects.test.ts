import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

describe('resolveTopOfStack replay side effects', () => {
  it('does not run live stack resolution while replaying persisted events', () => {
    const gameId = 't_resolve_stack_replay_skip';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const playerId = 'p1';
    game.applyEvent({ type: 'join', playerId, name: 'P1' });

    const handBefore = [{ id: 'hand_card_1', name: 'Hand Card', type_line: 'Instant' }];
    (game.state as any).zones = {
      [playerId]: {
        hand: handBefore.map((card) => ({ ...card })),
        handCount: 1,
        library: [
          { id: 'library_1', name: 'Library Card 1', type_line: 'Instant', oracle_text: 'Draw a card.' },
          { id: 'library_2', name: 'Library Card 2', type_line: 'Instant', oracle_text: 'Draw a card.' },
        ],
        libraryCount: 2,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.libraries as any).set(playerId, [
      { id: 'library_1', name: 'Library Card 1', type_line: 'Instant', oracle_text: 'Draw a card.' },
      { id: 'library_2', name: 'Library Card 2', type_line: 'Instant', oracle_text: 'Draw a card.' },
    ]);
    (game.state as any).stack = [{
      id: 'howling_mine_stack',
      type: 'triggered_ability',
      controller: playerId,
      sourceName: 'Howling Mine',
      description: 'if this artifact is untapped, that player draws an additional card.',
      triggerType: 'draw_step',
      effect: 'if this artifact is untapped, that player draws an additional card.',
    }];
    (game.state as any).battlefield = [{
      id: 'howling_mine_perm',
      controller: playerId,
      tapped: false,
      card: {
        id: 'howling_mine_card',
        name: 'Howling Mine',
        type_line: 'Artifact',
        oracle_text: 'At the beginning of each player\'s draw step, if Howling Mine is untapped, that player draws an additional card.',
      },
    }];

    game.replay([
      { type: 'resolveTopOfStack' },
    ] as any);

    expect((game.state as any).zones?.[playerId]?.hand?.map((card: any) => card.id)).toEqual(['hand_card_1']);
    expect((game.state as any).stack?.length).toBe(0);

    ResolutionQueueManager.removeQueue(gameId);
  });
});
