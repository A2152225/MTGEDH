import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';

describe('voteSubmit replay semantics', () => {
  it('rebuilds active vote state with the full persisted choice list', () => {
    const game = createInitialGameState('t_vote_submit_replay');

    game.applyEvent({
      type: 'voteSubmit',
      playerId: 'p1',
      voteId: 'vote_1',
      choices: ['grace', 'condemnation'],
      choice: 'grace',
      voteCount: 1,
    } as any);

    expect((game.state as any).activeVotes).toEqual({
      vote_1: {
        choices: ['grace', 'condemnation'],
        votes: [
          {
            playerId: 'p1',
            choice: 'grace',
            voteCount: 1,
          },
        ],
      },
    });
  });

  it('falls back to reconstructing choices from vote submissions for legacy thin events', () => {
    const game = createInitialGameState('t_vote_submit_replay_legacy');

    game.applyEvent({
      type: 'voteSubmit',
      playerId: 'p1',
      voteId: 'vote_legacy',
      choice: 'grace',
      voteCount: 1,
    } as any);

    expect((game.state as any).activeVotes).toEqual({
      vote_legacy: {
        choices: ['grace'],
        votes: [
          {
            playerId: 'p1',
            choice: 'grace',
            voteCount: 1,
          },
        ],
      },
    });
  });

  it('appends replayed votes to an existing active vote', () => {
    const game = createInitialGameState('t_vote_submit_replay_existing');

    (game.state as any).activeVotes = {
      vote_1: {
        choices: ['grace'],
        votes: [
          {
            playerId: 'p1',
            choice: 'grace',
            voteCount: 1,
          },
        ],
      },
    };

    game.applyEvent({
      type: 'voteSubmit',
      playerId: 'p2',
      voteId: 'vote_1',
      choice: 'condemnation',
      voteCount: 2,
    } as any);

    expect((game.state as any).activeVotes.vote_1).toEqual({
      choices: ['grace', 'condemnation'],
      votes: [
        {
          playerId: 'p1',
          choice: 'grace',
          voteCount: 1,
        },
        {
          playerId: 'p2',
          choice: 'condemnation',
          voteCount: 2,
        },
      ],
    });
  });
});