import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { getDurablePlayableFromExilePermissionForCard } from '../src/state/modules/durable-permissions.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('grant playable-from-exile choice replay semantics', () => {
  it('replays selected-card permission and clears the queued choice prompt', () => {
    const gameId = 't_grant_playable_from_exile_choice_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).turnNumber = 7;
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        exile: [
          {
            id: 'exiled_a',
            name: 'Card A',
            type_line: 'Sorcery',
            zone: 'exile',
            canBePlayedBy: p1,
            playableUntilTurn: 7,
          },
          {
            id: 'exiled_b',
            name: 'Card B',
            type_line: 'Land',
            zone: 'exile',
          },
        ],
        exileCount: 2,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };
    (game.state as any).playableFromExile = { [p1]: { exiled_a: 7 } };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      sourceId: 'source_perm_1',
      sourceName: 'Source',
      options: [
        { id: 'exiled_a', label: 'Card A' },
        { id: 'exiled_b', label: 'Card B' },
      ],
      grantPlayableFromExileChoice: true,
      grantPlayableFromExileController: p1,
      grantPlayableFromExileSourceName: 'Source',
      grantPlayableFromExileCardIds: ['exiled_a', 'exiled_b'],
    } as any);

    game.applyEvent({
      type: 'grantPlayableFromExileChoiceResolve',
      playerId: p1,
      controllerId: p1,
      sourceId: 'source_perm_1',
      sourceName: 'Source',
      resolvedStepId: step.id,
      chosenCardId: 'exiled_b',
      cardIds: ['exiled_a', 'exiled_b'],
      playableUntilTurn: 7,
      turnApplied: 7,
    } as any);

    const exile = (game.state as any).zones[p1].exile || [];
    const unselectedCard = exile.find((card: any) => card.id === 'exiled_a');
    const selectedCard = exile.find((card: any) => card.id === 'exiled_b');

    expect(unselectedCard.canBePlayedBy).toBeUndefined();
    expect(unselectedCard.playableUntilTurn).toBeUndefined();
    expect(selectedCard.canBePlayedBy).toBe(p1);
    expect(selectedCard.playableUntilTurn).toBe(7);
    expect((game.state as any).playableFromExile?.[p1]?.exiled_a).toBeUndefined();
    expect((game.state as any).playableFromExile?.[p1]?.exiled_b).toBe(7);
    expect(getDurablePlayableFromExilePermissionForCard(game.state as any, p1, selectedCard, 'play')).toBeDefined();
    const replayQueue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(replayQueue.activeStep?.grantPlayableFromExileChoice).not.toBe(true);
    expect((replayQueue.steps || []).some((queuedStep: any) => queuedStep?.grantPlayableFromExileChoice === true)).toBe(false);

    ResolutionQueueManager.removeQueue(gameId);
  });
});