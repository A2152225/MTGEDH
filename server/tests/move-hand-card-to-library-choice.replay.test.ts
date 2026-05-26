import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function addMoveHandCardPrompt(gameId: string, playerId: PlayerID, position: 'top' | 'bottom') {
  const step = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId,
    description: `Source: Choose a card from your hand to put on the ${position} of your library.`,
    mandatory: true,
    sourceName: 'Source',
    options: [
      { id: 'hand_a', label: 'Card A' },
      { id: 'hand_b', label: 'Card B' },
    ],
    minSelections: 1,
    maxSelections: 1,
    moveChosenHandCardToLibraryChoice: true,
    moveChosenHandCardToLibraryController: playerId,
    moveChosenHandCardToLibrarySourceName: 'Source',
    moveChosenHandCardToLibraryPosition: position,
  } as any);
  ResolutionQueueManager.activateStep(gameId, step.id);
  return step;
}

function setupGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  const game = createInitialGameState(gameId);
  const playerId = 'p1' as PlayerID;
  addPlayer(game, playerId, 'P1');
  (game.state as any).zones = {
    [playerId]: {
      hand: [
        { id: 'hand_a', name: 'Card A', type_line: 'Sorcery', zone: 'hand' },
        { id: 'hand_b', name: 'Card B', type_line: 'Instant', zone: 'hand' },
      ],
      handCount: 2,
      library: [{ id: 'lib_1', name: 'Existing Top', type_line: 'Land', zone: 'library' }],
      libraryCount: 1,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    },
  };
  (game as any).libraries = new Map([[playerId, [{ id: 'lib_1', name: 'Existing Top', type_line: 'Land', zone: 'library' }]]]);
  return { game, playerId };
}

describe('move chosen hand card to library replay semantics', () => {
  it('replays moving the selected hand card to the top of the library and clears the prompt', () => {
    const gameId = 't_move_hand_card_to_library_top_replay';
    const { game, playerId } = setupGame(gameId);
    const step = addMoveHandCardPrompt(gameId, playerId, 'top');

    game.applyEvent({
      type: 'moveChosenHandCardToLibraryChoiceResolve',
      playerId,
      controllerId: playerId,
      sourceName: 'Source',
      resolvedStepId: step.id,
      chosenCardId: 'hand_b',
      position: 'top',
      movedCardSnapshot: { id: 'hand_b', name: 'Card B', type_line: 'Instant', zone: 'library' },
    } as any);

    expect(((game.state as any).zones[playerId].hand || []).map((card: any) => card.id)).toEqual(['hand_a']);
    expect(((game as any).libraries.get(playerId) || []).map((card: any) => card.id)).toEqual(['hand_b', 'lib_1']);
    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.moveChosenHandCardToLibraryChoice).not.toBe(true);
    expect((queue.steps || []).some((entry: any) => entry?.moveChosenHandCardToLibraryChoice === true)).toBe(false);

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays moving the selected hand card to the bottom of the library', () => {
    const gameId = 't_move_hand_card_to_library_bottom_replay';
    const { game, playerId } = setupGame(gameId);
    const step = addMoveHandCardPrompt(gameId, playerId, 'bottom');

    game.applyEvent({
      type: 'moveChosenHandCardToLibraryChoiceResolve',
      playerId,
      controllerId: playerId,
      sourceName: 'Source',
      resolvedStepId: step.id,
      chosenCardId: 'hand_a',
      position: 'bottom',
      movedCardSnapshot: { id: 'hand_a', name: 'Card A', type_line: 'Sorcery', zone: 'library' },
    } as any);

    expect(((game.state as any).zones[playerId].hand || []).map((card: any) => card.id)).toEqual(['hand_b']);
    expect(((game as any).libraries.get(playerId) || []).map((card: any) => card.id)).toEqual(['lib_1', 'hand_a']);

    ResolutionQueueManager.removeQueue(gameId);
  });
});