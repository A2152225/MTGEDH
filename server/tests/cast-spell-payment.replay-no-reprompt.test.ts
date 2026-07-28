import { describe, expect, it, afterEach } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('cast spell payment replay', () => {
  afterEach(() => {
    // Isolation across gameIds is by id; remove known queues used here.
    for (const gameId of [
      't_cast_payment_replay_no_reprompt',
      't_cast_payment_replay_in_progress',
    ]) {
      ResolutionQueueManager.removeQueue(gameId);
    }
  });

  it('does not re-prompt mana payment after castSpell is in the event log', () => {
    const gameId = 't_cast_payment_replay_no_reprompt';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const zones = (game.state as any).zones[p1];
    zones.hand = [{
      id: 'divination_1',
      name: 'Divination',
      type_line: 'Sorcery',
      mana_cost: '{2}{U}',
      oracle_text: 'Draw two cards.',
      zone: 'hand',
    }];
    zones.handCount = 1;
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
    };

    game.replay([
      {
        type: 'castSpellContinuation',
        playerId: p1,
        cardId: 'divination_1',
        effectId: 'cast_divination_1',
        pendingSpellCast: {
          effectId: 'cast_divination_1',
          cardId: 'divination_1',
          cardName: 'Divination',
          manaCost: '{2}{U}',
          fromZone: 'hand',
          playerId: p1,
        },
        queuedResolutionStep: {
          id: 'queued_divination_payment_1',
          type: ResolutionStepType.MANA_PAYMENT_CHOICE,
          playerId: p1,
          sourceId: 'divination_1',
          sourceName: 'Divination',
          description: 'Pay costs to cast Divination.',
          mandatory: true,
          spellPaymentRequired: true,
          cardId: 'divination_1',
          cardName: 'Divination',
          manaCost: '{2}{U}',
          effectId: 'cast_divination_1',
        },
      },
      {
        type: 'castSpell',
        playerId: p1,
        cardId: 'divination_1',
        card: {
          id: 'divination_1',
          name: 'Divination',
          type_line: 'Sorcery',
          mana_cost: '{2}{U}',
          oracle_text: 'Draw two cards.',
        },
        fromZone: 'hand',
        paymentManaDelta: { blue: -1, colorless: -2 },
        manaPayment: [{ source: 'pool', color: 'blue', amount: 1 }],
      },
    ] as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const pendingPayments = queue.steps.filter((step: any) =>
      step?.status === 'pending'
      && step?.type === ResolutionStepType.MANA_PAYMENT_CHOICE
      && step?.spellPaymentRequired === true
    );
    expect(pendingPayments).toHaveLength(0);
    expect((game.state as any).pendingSpellCasts?.cast_divination_1).toBeUndefined();
    expect((game.state.stack || []).some((item: any) => String(item?.card?.id || item?.cardId || '') === 'divination_1')).toBe(true);
  });

  it('keeps mana payment prompt when replay ends mid-cast', () => {
    const gameId = 't_cast_payment_replay_in_progress';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const zones = (game.state as any).zones[p1];
    zones.hand = [{
      id: 'divination_1',
      name: 'Divination',
      type_line: 'Sorcery',
      mana_cost: '{2}{U}',
      oracle_text: 'Draw two cards.',
      zone: 'hand',
    }];
    zones.handCount = 1;

    game.replay([
      {
        type: 'castSpellContinuation',
        playerId: p1,
        cardId: 'divination_1',
        effectId: 'cast_divination_1_mid',
        pendingSpellCast: {
          effectId: 'cast_divination_1_mid',
          cardId: 'divination_1',
          cardName: 'Divination',
          manaCost: '{2}{U}',
          fromZone: 'hand',
          playerId: p1,
        },
        queuedResolutionStep: {
          id: 'queued_divination_payment_mid',
          type: ResolutionStepType.MANA_PAYMENT_CHOICE,
          playerId: p1,
          sourceId: 'divination_1',
          sourceName: 'Divination',
          description: 'Pay costs to cast Divination.',
          mandatory: true,
          spellPaymentRequired: true,
          cardId: 'divination_1',
          cardName: 'Divination',
          manaCost: '{2}{U}',
          effectId: 'cast_divination_1_mid',
        },
      },
    ] as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const pendingPayments = queue.steps.filter((step: any) =>
      step?.status === 'pending'
      && step?.type === ResolutionStepType.MANA_PAYMENT_CHOICE
      && step?.spellPaymentRequired === true
    );
    expect(pendingPayments).toHaveLength(1);
    expect((game.state as any).pendingSpellCasts?.cast_divination_1_mid?.cardId).toBe('divination_1');
  });
});
