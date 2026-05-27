import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function addActiveVoteStep(gameId: string, playerId: string, voteId: string) {
  const step = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.VOTE,
    playerId: playerId as any,
    description: 'Vote.',
    mandatory: true,
    voteId,
    choices: ['grace', 'condemnation'],
  } as any);
  ResolutionQueueManager.activateStep(gameId, step.id);
  return step;
}

describe('voteSubmit replay semantics', () => {
  it('rebuilds active vote state with the full persisted choice list', () => {
    const gameId = 't_vote_submit_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const step = addActiveVoteStep(gameId, 'p1', 'vote_1');

    game.applyEvent({
      type: 'voteSubmit',
      playerId: 'p1',
      resolvedStepId: step.id,
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
    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.type).not.toBe(ResolutionStepType.VOTE);
    expect((queue.steps || []).some((entry: any) => entry?.type === ResolutionStepType.VOTE)).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
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