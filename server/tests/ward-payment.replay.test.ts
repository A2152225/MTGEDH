import { beforeEach, describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
}

describe('ward payment replay semantics', () => {
  beforeEach(() => {
    resetGame('t_target_selection_ward_prompt_replay');
    resetGame('t_ward_payment_resolve_replay');
    resetGame('t_ward_discard_payment_resolve_replay');
    resetGame('t_ward_madness_payment_resolve_replay');
  });

  it('replays targetSelectionWardPrompt by restoring stack targets and queued ward prompts', () => {
    const gameId = 't_target_selection_ward_prompt_replay';

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

  it('replays wardPaymentResolve by clearing the queued prompt and restoring Treasure-backed payment evidence', () => {
    const gameId = 't_ward_payment_resolve_replay';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
      [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'treasure_1',
        controller: p1,
        owner: p1,
        tapped: false,
        isToken: true,
        card: {
          id: 'treasure_card_1',
          name: 'Treasure',
          type_line: 'Token Artifact — Treasure',
          oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.',
          zone: 'battlefield',
        },
      },
    ];
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
      targets: ['ward_perm_1'],
      queuedResolutionStep: {
        id: 'queued_ward_payment_1',
        type: ResolutionStepType.MANA_PAYMENT_CHOICE,
        playerId: p1,
        sourceId: 'spell_1',
        sourceName: 'Guarded Bear',
        description: 'Guarded Bear has ward {2}. Pay {2} or the spell/ability will be countered.',
        mandatory: false,
        cardName: 'Guarded Bear Ward',
        manaCost: '{2}',
        wardPayment: true,
        wardPaymentType: 'mana',
        wardCost: '{2}',
        wardPermanentId: 'ward_perm_1',
        wardPermanentName: 'Guarded Bear',
        wardPermanentController: p2,
        wardTriggeredBy: 'spell_1',
      },
    } as any);

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_ward_payment_1');

    game.applyEvent({
      type: 'wardPaymentResolve',
      playerId: p1,
      stepId: 'queued_ward_payment_1',
      sourceId: 'spell_1',
      wardCost: '{2}',
      wardPermanentId: 'ward_perm_1',
      wardPermanentName: 'Guarded Bear',
      wardPaymentType: 'mana',
      tappedPermanents: ['treasure_1'],
      sacrificedPermanents: ['treasure_1'],
      paymentManaDelta: { colorless: -1 },
    } as any);

    queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(0);
    const stackItem = ((game.state as any).stack || []).find((item: any) => item.id === 'spell_1');
    expect(stackItem?.targets).toEqual(['ward_perm_1']);
    expect(((game.state as any).battlefield || []).some((entry: any) => entry?.id === 'treasure_1')).toBe(false);
    expect((((game.state as any).zones?.[p1]?.graveyard) || []).some((card: any) => card?.name === 'Treasure')).toBe(true);
    expect((game.state as any).manaPool?.[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('replays discard ward payments by clearing the queued prompt after the discard is persisted', () => {
    const gameId = 't_ward_discard_payment_resolve_replay';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'ward_discard_card_1',
            name: 'Ward Payment Card',
            type_line: 'Creature - Shade',
            oracle_text: '',
            zone: 'hand',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };
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
      targets: ['ward_perm_1'],
      queuedResolutionStep: {
        id: 'queued_ward_discard_payment_1',
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: p1,
        sourceId: 'spell_1',
        sourceName: 'Guarded Bear',
        description: 'Guarded Bear has ward-Discard a card. Discard a card or the spell/ability will be countered.',
        mandatory: true,
        discardCount: 1,
        hand: [
          {
            id: 'ward_discard_card_1',
            name: 'Ward Payment Card',
            type_line: 'Creature - Shade',
            oracle_text: '',
          },
        ],
        wardPayment: true,
        wardPaymentType: 'discard',
        wardCost: 'Discard a card',
        wardPermanentId: 'ward_perm_1',
        wardPermanentName: 'Guarded Bear',
        wardPermanentController: p2,
        wardTriggeredBy: 'spell_1',
      },
    } as any);

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_ward_discard_payment_1');

    game.applyEvent({
      type: 'discardEffect',
      playerId: p1,
      cardIds: ['ward_discard_card_1'],
      destination: 'graveyard',
    } as any);
    game.applyEvent({
      type: 'wardPaymentResolve',
      playerId: p1,
      stepId: 'queued_ward_discard_payment_1',
      sourceId: 'spell_1',
      wardCost: 'Discard a card',
      wardPermanentId: 'ward_perm_1',
      wardPermanentName: 'Guarded Bear',
      wardPaymentType: 'discard',
    } as any);

    queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(0);
    const stackItem = ((game.state as any).stack || []).find((item: any) => item.id === 'spell_1');
    expect(stackItem?.targets).toEqual(['ward_perm_1']);
    expect((((game.state as any).zones?.[p1]?.graveyard) || []).some((card: any) => card?.id === 'ward_discard_card_1')).toBe(true);
    expect((((game.state as any).zones?.[p1]?.hand) || []).some((card: any) => card?.id === 'ward_discard_card_1')).toBe(false);
  });

  it('replays discard-to-ward madness by clearing the ward prompt and leaving the madness prompt queued', () => {
    const gameId = 't_ward_madness_payment_resolve_replay';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'ward_madness_card_1',
            name: 'Fiery Temper',
            type_line: 'Instant',
            oracle_text: 'Madness {R}',
            zone: 'hand',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };
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
      targets: ['ward_perm_1'],
      queuedResolutionStep: {
        id: 'queued_ward_madness_payment_1',
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: p1,
        sourceId: 'spell_1',
        sourceName: 'Guarded Bear',
        description: 'Guarded Bear has ward-Discard a card. Discard a card or the spell/ability will be countered.',
        mandatory: true,
        discardCount: 1,
        hand: [
          {
            id: 'ward_madness_card_1',
            name: 'Fiery Temper',
            type_line: 'Instant',
            oracle_text: 'Madness {R}',
          },
        ],
        wardPayment: true,
        wardPaymentType: 'discard',
        wardCost: 'Discard a card',
        wardPermanentId: 'ward_perm_1',
        wardPermanentName: 'Guarded Bear',
        wardPermanentController: p2,
        wardTriggeredBy: 'spell_1',
      },
    } as any);

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_ward_madness_payment_1');

    game.applyEvent({
      type: 'discardEffect',
      playerId: p1,
      cardIds: ['ward_madness_card_1'],
      destination: 'exile',
    } as any);
    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'ward_madness_card_1',
      queuedResolutionStep: {
        id: 'queued_madness_prompt_1',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: p1,
        sourceId: 'ward_madness_card_1',
        sourceName: 'Madness',
        description: 'Madness: You may cast Fiery Temper for {R}.',
        mandatory: false,
        options: [
          { id: 'cast', label: 'Cast for Madness ({R})' },
          { id: 'decline', label: 'Decline' },
        ],
        minSelections: 1,
        maxSelections: 1,
        madnessPrompt: true,
        madnessCardId: 'ward_madness_card_1',
        madnessCost: '{R}',
        castFromExileCardId: 'ward_madness_card_1',
        castFromExileDeclineDestination: 'graveyard',
        castFromExileForcedAlternateCostId: 'madness',
        castFromExileCastWithoutPayingManaCost: false,
        castFromExileBypassExilePermissionCheck: true,
        castFromExileIgnoreTimingRestrictions: true,
      },
    } as any);
    game.applyEvent({
      type: 'wardPaymentResolve',
      playerId: p1,
      stepId: 'queued_ward_madness_payment_1',
      sourceId: 'spell_1',
      wardCost: 'Discard a card',
      wardPermanentId: 'ward_perm_1',
      wardPermanentName: 'Guarded Bear',
      wardPaymentType: 'discard',
    } as any);

    queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_madness_prompt_1');
    expect(String((queue.steps[0] as any)?.castFromExileCardId || '')).toBe('ward_madness_card_1');
    const stackItem = ((game.state as any).stack || []).find((item: any) => item.id === 'spell_1');
    expect(stackItem?.targets).toEqual(['ward_perm_1']);
    expect((((game.state as any).zones?.[p1]?.exile) || []).some((card: any) => card?.id === 'ward_madness_card_1')).toBe(true);
    expect((((game.state as any).zones?.[p1]?.hand) || []).some((card: any) => card?.id === 'ward_madness_card_1')).toBe(false);
  });
});