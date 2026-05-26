import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function addChooseSplitterPrompt(gameId: string, controllerId: PlayerID, opponentId: PlayerID) {
  const step = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: controllerId,
    description: 'Source: Choose a player to split cards',
    mandatory: true,
    sourceName: 'Source',
    options: [{ id: opponentId, label: 'Opponent' }],
    minSelections: 1,
    maxSelections: 1,
    choosePlayerForTwoPileSplitChoice: true,
    choosePlayerForTwoPileSplitController: controllerId,
    choosePlayerForTwoPileSplitSourceName: 'Source',
    choosePlayerForTwoPileSplitDescription: 'Source: Separate the revealed cards into two piles',
    choosePlayerForTwoPileSplitItems: [
      { id: 'c1', label: 'Card 1' },
      { id: 'c2', label: 'Card 2' },
      { id: 'c3', label: 'Card 3' },
    ],
    choosePlayerForTwoPileSplitMinPerPile: 0,
    choosePileFromSplitChoice: true,
    choosePileFromSplitChooserPlayerId: controllerId,
    choosePileFromSplitSourceName: 'Source',
    choosePileFromSplitItems: [
      { id: 'c1', name: 'Card 1' },
      { id: 'c2', name: 'Card 2' },
      { id: 'c3', name: 'Card 3' },
    ],
    choosePileFromSplitOriginalOrder: ['c1', 'c2', 'c3'],
    choosePileFromSplitChosenAction: 'move_cards',
    choosePileFromSplitChosenDestination: 'hand',
    choosePileFromSplitOtherDestination: 'library',
    choosePileFromSplitMovePlayerId: controllerId,
    choosePileFromSplitChoiceDescription: 'Source: Choose a pile',
  } as any);
  ResolutionQueueManager.activateStep(gameId, step.id);
  return step;
}

describe('choose player for two-pile split replay semantics', () => {
  it('replays the chosen splitter by clearing the chooser prompt and restoring the split prompt', () => {
    const gameId = 't_choose_player_for_two_pile_split_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');
    const step = addChooseSplitterPrompt(gameId, p1, p2);

    game.applyEvent({
      type: 'choosePlayerForTwoPileSplitChoiceResolve',
      playerId: p1,
      controllerId: p1,
      sourceName: 'Source',
      resolvedStepId: step.id,
      chosenOpponentId: p2,
      itemIds: ['c1', 'c2', 'c3'],
      queuedResolutionStep: {
        id: 'two_pile_split_1',
        type: ResolutionStepType.TWO_PILE_SPLIT,
        playerId: p2,
        description: 'Source: Separate the revealed cards into two piles',
        mandatory: true,
        sourceName: 'Source',
        items: [
          { id: 'c1', label: 'Card 1' },
          { id: 'c2', label: 'Card 2' },
          { id: 'c3', label: 'Card 3' },
        ],
        minPerPile: 0,
        choosePileFromSplitChoice: true,
        choosePileFromSplitChooserPlayerId: p1,
        choosePileFromSplitSourceName: 'Source',
        choosePileFromSplitItems: [
          { id: 'c1', name: 'Card 1' },
          { id: 'c2', name: 'Card 2' },
          { id: 'c3', name: 'Card 3' },
        ],
        choosePileFromSplitOriginalOrder: ['c1', 'c2', 'c3'],
        choosePileFromSplitChosenAction: 'move_cards',
        choosePileFromSplitChosenDestination: 'hand',
        choosePileFromSplitOtherDestination: 'library',
        choosePileFromSplitMovePlayerId: p1,
        choosePileFromSplitChoiceDescription: 'Source: Choose a pile',
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.choosePlayerForTwoPileSplitChoice).not.toBe(true);
    expect((queue.steps || []).some((entry: any) => entry?.choosePlayerForTwoPileSplitChoice === true)).toBe(false);
    const splitStep = (queue.steps || []).find((entry: any) => entry?.type === ResolutionStepType.TWO_PILE_SPLIT);
    expect(splitStep).toMatchObject({
      id: 'two_pile_split_1',
      playerId: p2,
      choosePileFromSplitChoice: true,
      choosePileFromSplitMovePlayerId: p1,
    });
    expect((splitStep.items || []).map((item: any) => item.id)).toEqual(['c1', 'c2', 'c3']);

    ResolutionQueueManager.removeQueue(gameId);
  });
});