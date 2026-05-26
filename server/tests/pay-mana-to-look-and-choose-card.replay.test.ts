import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('pay mana to look and choose card replay semantics', () => {
  it('replays mana payment and queues the looked-at-card destination prompt', () => {
    const gameId = 't_pay_mana_to_look_and_choose_card_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = { [p1]: { colorless: 2, blue: 1 } };
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

    const payStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      sourceName: 'Source',
      description: 'Source: Pay any amount of mana',
      mandatory: true,
      options: [
        { id: '0', label: '0' },
        { id: '2', label: '2' },
      ],
      minSelections: 1,
      maxSelections: 1,
      payManaToLookAndChooseCardChoice: true,
      payManaToLookAndChooseCardController: p1,
      payManaToLookAndChooseCardSourceName: 'Source',
    } as any);
    ResolutionQueueManager.activateStep(gameId, payStep.id);

    const queuedResolutionStep = {
      id: 'look_destination_after_pay_1',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: Choose a card to put into your hand',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'top_1', label: 'Top One', description: 'Instant' },
        { id: 'top_2', label: 'Top Two', description: 'Sorcery' },
      ],
      minSelections: 1,
      maxSelections: 1,
      chooseLookedAtCardsDestinationChoice: true,
      chooseLookedAtCardsDestinationController: p1,
      chooseLookedAtCardsDestinationSourceName: 'Source',
      chooseLookedAtCardsDestinationTopCardIds: ['top_1', 'top_2'],
      chooseLookedAtCardsDestinationChosenZone: 'hand',
      chooseLookedAtCardsDestinationOtherZone: 'bottom_library',
      chooseLookedAtCardsDestinationRandomizeOtherOrder: true,
    };

    game.applyEvent({
      type: 'payManaToLookAndChooseCardChoiceResolve',
      playerId: p1,
      controllerId: p1,
      sourceName: 'Source',
      resolvedStepId: payStep.id,
      chosenAmount: 2,
      lookedAtCardIds: ['top_1', 'top_2'],
      paymentManaDelta: { colorless: -2 },
      queuedResolutionStep,
    } as any);

    expect((game.state as any).manaPool[p1].colorless).toBe(0);
    expect((game.state as any).manaPool[p1].blue).toBe(1);
    expect(((game.state as any).zones[p1].library || []).map((card: any) => card.id)).toEqual(['top_1', 'top_2', 'rest_1']);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.payManaToLookAndChooseCardChoice).not.toBe(true);
    expect((queue.steps || []).some((step: any) => step?.payManaToLookAndChooseCardChoice === true)).toBe(false);

    const destinationStep = (queue.steps || []).find((step: any) => step?.chooseLookedAtCardsDestinationChoice === true);
    expect(destinationStep).toBeDefined();
    expect(destinationStep.id).toBe('look_destination_after_pay_1');
    expect(destinationStep.chooseLookedAtCardsDestinationTopCardIds).toEqual(['top_1', 'top_2']);
    expect(destinationStep.chooseLookedAtCardsDestinationRandomizeOtherOrder).toBe(true);

    ResolutionQueueManager.removeQueue(gameId);
  });
});