import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('choose player for looked-at cards replay semantics', () => {
  it('replays the chosen-player response by clearing the chooser and queuing the destination prompt', () => {
    const gameId = 't_choose_player_for_looked_at_cards_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    const chooserStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      sourceName: 'Source',
      description: 'Source: Choose an opponent to make the choice',
      mandatory: true,
      options: [{ id: p2, label: 'P2' }],
      minSelections: 1,
      maxSelections: 1,
      choosePlayerForLookedAtCardsChoice: true,
      choosePlayerForLookedAtCardsController: p1,
      choosePlayerForLookedAtCardsSourceName: 'Source',
    } as any);
    ResolutionQueueManager.activateStep(gameId, chooserStep.id);

    const queuedResolutionStep = {
      id: 'looked_destination_step_1',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p2,
      description: `Source: Choose a card to put into P1's hand`,
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'top_1', label: 'Top One', description: 'Artifact' },
        { id: 'top_2', label: 'Top Two', description: 'Instant' },
      ],
      minSelections: 1,
      maxSelections: 1,
      chooseLookedAtCardsDestinationChoice: true,
      chooseLookedAtCardsDestinationController: p1,
      chooseLookedAtCardsDestinationSourceName: 'Source',
      chooseLookedAtCardsDestinationTopCardIds: ['top_1', 'top_2'],
      chooseLookedAtCardsDestinationChosenZone: 'hand',
      chooseLookedAtCardsDestinationOtherZone: 'exile',
      chooseLookedAtCardsDestinationOtherCardPatch: { silverCounters: 1, exiledBy: 'Source' },
    };

    game.applyEvent({
      type: 'choosePlayerForLookedAtCardsChoiceResolve',
      playerId: p1,
      controllerId: p1,
      sourceName: 'Source',
      resolvedStepId: chooserStep.id,
      chosenPlayerId: p2,
      queuedResolutionStep,
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.choosePlayerForLookedAtCardsChoice).not.toBe(true);
    expect((queue.steps || []).some((step: any) => step?.choosePlayerForLookedAtCardsChoice === true)).toBe(false);

    const destinationStep = (queue.steps || []).find((step: any) => step?.chooseLookedAtCardsDestinationChoice === true);
    expect(destinationStep).toBeDefined();
    expect(destinationStep.id).toBe('looked_destination_step_1');
    expect(destinationStep.playerId).toBe(p2);
    expect(destinationStep.chooseLookedAtCardsDestinationController).toBe(p1);
    expect(destinationStep.chooseLookedAtCardsDestinationOtherCardPatch).toEqual({ silverCounters: 1, exiledBy: 'Source' });

    ResolutionQueueManager.removeQueue(gameId);
  });
});