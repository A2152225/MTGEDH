import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('playerChoice replay semantics', () => {
  it('replays the chosen player onto the permanent and clears the restored prompt', () => {
    const gameId = 't_player_choice_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).battlefield = [
      {
        id: 'xantcha_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'xantcha_card_1',
          name: 'Xantcha, Sleeper Agent',
          type_line: 'Legendary Creature',
        },
      },
    ];

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.PLAYER_CHOICE,
      playerId: p1,
      description: 'Choose a player.',
      mandatory: true,
      permanentId: 'xantcha_1',
    } as any);
    ResolutionQueueManager.activateStep(gameId, step.id);

    game.applyEvent({
      type: 'playerChoice',
      playerId: p1,
      resolvedStepId: step.id,
      resolvedStepType: ResolutionStepType.PLAYER_CHOICE,
      permanentId: 'xantcha_1',
      cardName: 'Xantcha, Sleeper Agent',
      chosenPlayer: p2,
    } as any);

    expect(((game.state as any).battlefield || [])[0]?.chosenPlayer).toBe(p2);
    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.type).not.toBe(ResolutionStepType.PLAYER_CHOICE);
    expect((queue.steps || []).some((entry: any) => entry?.type === ResolutionStepType.PLAYER_CHOICE)).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
  });
});