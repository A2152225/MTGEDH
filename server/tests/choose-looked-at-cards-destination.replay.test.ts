import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('choose looked-at cards destination replay semantics', () => {
  it('replays the chosen destination move and clears the queued prompt', () => {
    const gameId = 't_choose_looked_at_cards_destination_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).zones = {
      [p1]: {
        library: [
          { id: 'top_1', name: 'Top One', type_line: 'Instant', zone: 'library' },
          { id: 'top_2', name: 'Top Two', type_line: 'Sorcery', zone: 'library' },
          { id: 'rest_1', name: 'Rest', type_line: 'Land', zone: 'library' },
        ],
        libraryCount: 3,
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      sourceName: 'Source',
      description: 'Source: Put one into your hand and the other on the bottom of your library.',
      mandatory: true,
      options: [
        { id: 'top_1', label: 'Top One' },
        { id: 'top_2', label: 'Top Two' },
      ],
      minSelections: 1,
      maxSelections: 1,
      chooseLookedAtCardsDestinationChoice: true,
      chooseLookedAtCardsDestinationController: p1,
      chooseLookedAtCardsDestinationSourceName: 'Source',
      chooseLookedAtCardsDestinationTopCardIds: ['top_1', 'top_2'],
      chooseLookedAtCardsDestinationChosenZone: 'hand',
      chooseLookedAtCardsDestinationOtherZone: 'bottom_library',
    } as any);
    ResolutionQueueManager.activateStep(gameId, step.id);

    game.applyEvent({
      type: 'chooseLookedAtCardsDestinationResolve',
      playerId: p1,
      controllerId: p1,
      sourceName: 'Source',
      resolvedStepId: step.id,
      chosenCardId: 'top_2',
      topCardIds: ['top_1', 'top_2'],
      chosenZone: 'hand',
      otherZone: 'bottom_library',
      chosenCard: { id: 'top_2', name: 'Top Two', type_line: 'Sorcery', zone: 'library' },
      otherCards: [{ id: 'top_1', name: 'Top One', type_line: 'Instant', zone: 'library' }],
    } as any);

    expect(((game.state as any).zones[p1].hand || []).map((card: any) => card.id)).toEqual(['top_2']);
    expect(((game.state as any).zones[p1].library || []).map((card: any) => card.id)).toEqual(['rest_1', 'top_1']);
    expect((game.state as any).zones[p1].libraryCount).toBe(2);
    expect((game.state as any).zones[p1].handCount).toBe(1);

    const replayQueue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(replayQueue.activeStep?.chooseLookedAtCardsDestinationChoice).not.toBe(true);
    expect((replayQueue.steps || []).some((queuedStep: any) => queuedStep?.chooseLookedAtCardsDestinationChoice === true)).toBe(false);

    ResolutionQueueManager.removeQueue(gameId);
  });
});