import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function addActiveCardNameStep(gameId: string, playerId: PlayerID, extra: Record<string, any>) {
  const step = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.CARD_NAME_CHOICE,
    playerId,
    description: 'Choose a card name.',
    mandatory: true,
    ...extra,
  } as any);
  ResolutionQueueManager.activateStep(gameId, step.id);
  return step;
}

function expectCardNameStepCleared(gameId: string) {
  const queue = ResolutionQueueManager.getQueue(gameId) as any;
  expect(queue.activeStep?.type).not.toBe(ResolutionStepType.CARD_NAME_CHOICE);
  expect((queue.steps || []).some((entry: any) => entry?.type === ResolutionStepType.CARD_NAME_CHOICE)).toBe(false);
}

describe('cardNameChoice replay semantics', () => {
  it('replays the chosen card name onto the selected permanent', () => {
    const gameId = 't_card_name_choice_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    const step = addActiveCardNameStep(gameId, p1, { permanentId: 'needle_1' });

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
      resolvedStepId: step.id,
      resolvedStepType: ResolutionStepType.CARD_NAME_CHOICE,
      permanentId: 'needle_1',
      cardName: 'Pithing Needle',
      chosenName: 'Black Lotus',
    } as any);

    expect(((game.state as any).battlefield || [])[0]?.chosenCardName).toBe('Black Lotus');
    expectCardNameStepCleared(gameId);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('falls back to player and card name when replay cannot reconstruct the original permanent id', () => {
    const gameId = 't_card_name_choice_replay_fallback';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    const step = addActiveCardNameStep(gameId, p1, { permanentId: 'needle_live_random_id' });

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
      resolvedStepId: step.id,
      resolvedStepType: ResolutionStepType.CARD_NAME_CHOICE,
      permanentId: 'needle_live_random_id',
      cardName: 'Pithing Needle',
      chosenName: 'Sol Ring',
    } as any);

    expect(((game.state as any).battlefield || [])[0]?.chosenCardName).toBe('Sol Ring');
    expect((game.state as any).replayPermanentAliases).toEqual({
      needle_live_random_id: 'needle_replay_1',
    });
    expectCardNameStepCleared(gameId);
    ResolutionQueueManager.removeQueue(gameId);
  });
});