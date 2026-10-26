import { beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;

function pendingIds(gameId: string): string[] {
  const queue = ResolutionQueueManager.getQueue(gameId) as any;
  return [...(queue.steps || []), queue.activeStep]
    .filter((step) => step && step.status !== 'completed' && step.status !== 'cancelled')
    .map((step) => String(step.id || ''));
}

function replay(gameId: string, events: any[]) {
  ResolutionQueueManager.removeQueue(gameId);
  const game = createInitialGameState(gameId);
  game.replay!(events);
  return game;
}

describe('replay does not re-ask prompts it already played past', () => {
  const gameId = 'replay_completed_prompt';

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('keeps a scry prompt when the replay ends on it', () => {
    replay(gameId, [
      { type: 'join', playerId: p1, name: 'P1' },
      {
        type: 'resolveTopOfStackPrompt',
        playerId: p1,
        queuedResolutionStep: {
          id: 'step-scry',
          type: ResolutionStepType.SCRY,
          playerId: p1,
          description: 'Scry 2',
          mandatory: true,
          scryCount: 2,
        },
      },
    ]);

    expect(pendingIds(gameId)).toContain('step-scry');
  });

  it('drops a scry prompt once a later event shows the choice was finished', () => {
    replay(gameId, [
      { type: 'join', playerId: p1, name: 'P1' },
      {
        type: 'resolveTopOfStackPrompt',
        playerId: p1,
        queuedResolutionStep: {
          id: 'step-scry',
          type: ResolutionStepType.SCRY,
          playerId: p1,
          description: 'Scry 2',
          mandatory: true,
          scryCount: 2,
        },
      },
      { type: 'scryResolve', playerId: p1, resolvedStepId: 'step-scry', top: [], bottom: [] },
      { type: 'passPriority', by: p1 },
    ]);

    expect(pendingIds(gameId)).not.toContain('step-scry');
  });

  it('drops a target prompt whose answer event does not repeat the step id', () => {
    replay(gameId, [
      { type: 'join', playerId: p1, name: 'P1' },
      {
        type: 'resolveTopOfStackPrompt',
        playerId: p1,
        queuedResolutionStep: {
          id: 'step-goad',
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: p1,
          description: 'Goad target creature',
          mandatory: true,
        },
      },
      { type: 'assignTriggeredAbilityTargets', playerId: p1, targets: ['perm_1'] },
    ]);

    expect(pendingIds(gameId)).not.toContain('step-goad');
  });

  it('keeps the prompt the replay stops on and drops the one before it', () => {
    replay(gameId, [
      { type: 'join', playerId: p1, name: 'P1' },
      {
        type: 'resolveTopOfStackPrompt',
        playerId: p1,
        queuedResolutionStep: {
          id: 'step-first',
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: p1,
          description: 'You may gain 1 life',
          mandatory: false,
        },
      },
      {
        type: 'resolveTopOfStackPrompt',
        playerId: p1,
        queuedResolutionStep: {
          id: 'step-second',
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: p1,
          description: 'Choose a target',
          mandatory: true,
        },
      },
    ]);

    expect(pendingIds(gameId)).not.toContain('step-first');
    expect(pendingIds(gameId)).toContain('step-second');
  });

  it('closes only the named step when several players were prompted together', () => {
    replay(gameId, [
      { type: 'join', playerId: p1, name: 'P1' },
      { type: 'join', playerId: p2, name: 'P2' },
      {
        type: 'resolveTopOfStackPrompt',
        playerId: p1,
        queuedResolutionSteps: [
          {
            id: 'step-p1',
            type: ResolutionStepType.TARGET_SELECTION,
            playerId: p1,
            description: 'Blight: choose a creature',
            mandatory: true,
          },
          {
            id: 'step-p2',
            type: ResolutionStepType.TARGET_SELECTION,
            playerId: p2,
            description: 'Blight: choose a creature',
            mandatory: true,
          },
        ],
      },
      { type: 'assignTriggeredAbilityTargets', playerId: p1, resolvedStepId: 'step-p1', targets: ['perm_1'] },
    ]);

    expect(pendingIds(gameId)).not.toContain('step-p1');
    expect(pendingIds(gameId)).toContain('step-p2');
  });
});
