import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('ward payment replay semantics', () => {
  it('replays targetSelectionWardPrompt by restoring stack targets and queued ward prompts', () => {
    const gameId = 't_target_selection_ward_prompt_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).stack = [
      {
        id: 'spell_1',
        type: 'spell',
        controller: p1,
        sourceName: 'Twin Barrage',
        targets: [],
        card: {
          id: 'spell_card_1',
          name: 'Twin Barrage',
          type_line: 'Instant',
          oracle_text: 'Twin Barrage deals 2 damage divided as you choose among one or two targets.',
          zone: 'stack',
        },
      },
    ];

    game.applyEvent({
      type: 'targetSelectionWardPrompt',
      playerId: p1,
      sourceId: 'spell_1',
      targets: ['ward_perm_1', 'ward_perm_2'],
      queuedResolutionSteps: [
        {
          id: 'queued_ward_payment_1',
          type: ResolutionStepType.MANA_PAYMENT_CHOICE,
          playerId: p1,
          sourceId: 'spell_1',
          sourceName: 'Shielded Bear',
          description: 'Shielded Bear has ward {1}. Pay {1} or the spell/ability will be countered.',
          mandatory: false,
          cardName: 'Shielded Bear Ward',
          manaCost: '{1}',
          wardPayment: true,
          wardPaymentType: 'mana',
          wardCost: '{1}',
          wardPermanentId: 'ward_perm_1',
          wardPermanentName: 'Shielded Bear',
          wardPermanentController: p2,
          wardTriggeredBy: 'spell_1',
        },
        {
          id: 'queued_ward_payment_2',
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: p1,
          sourceId: 'spell_1',
          sourceName: 'Spiteful Phantom',
          description: 'Spiteful Phantom has ward—Pay 3 life. Pay 3 life or the spell/ability will be countered.',
          mandatory: true,
          minSelections: 1,
          maxSelections: 1,
          options: [
            { id: 'pay_ward_cost', label: 'Pay 3 life' },
            { id: 'decline_ward_cost', label: 'Decline (counter)' },
          ],
          wardPayment: true,
          wardPaymentType: 'life',
          wardCost: 'Pay 3 life',
          wardLifeAmount: 3,
          wardPermanentId: 'ward_perm_2',
          wardPermanentName: 'Spiteful Phantom',
          wardPermanentController: p2,
          wardTriggeredBy: 'spell_1',
        },
      ],
    } as any);

    const stackItem = ((game.state as any).stack || []).find((item: any) => item.id === 'spell_1');
    expect(stackItem?.targets).toEqual(['ward_perm_1', 'ward_perm_2']);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(2);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_ward_payment_1');
    expect(String((queue.steps[1] as any)?.id || '')).toBe('queued_ward_payment_2');
    expect((queue.steps[0] as any)?.wardPaymentType).toBe('mana');
    expect((queue.steps[1] as any)?.wardPaymentType).toBe('life');
  });
});