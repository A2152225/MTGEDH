import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('land choice replay semantics', () => {
  it('replays sacrifice-unless-pay by consuming mana and keeping the permanent', () => {
    const gameId = 't_sacrifice_unless_pay_replay_pay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [
      {
        id: 'promenade_1',
        controller: p1,
        owner: p1,
        tapped: true,
        card: {
          id: 'promenade_card',
          name: 'Transguild Promenade',
          type_line: 'Land',
          oracle_text: 'When Transguild Promenade enters the battlefield, sacrifice it unless you pay {1}.',
        },
      },
    ];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };

    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.addStep(gameId, {
      id: 'sacrifice_unless_pay_step_1',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Pay {1}?',
      mandatory: true,
      sacrificeUnlessPayChoice: true,
      permanentId: 'promenade_1',
      sourceId: 'promenade_1',
    } as any);

    game.applyEvent({
      type: 'sacrificeUnlessPayChoice',
      playerId: p1,
      resolvedStepId: 'sacrifice_unless_pay_step_1',
      permanentId: 'promenade_1',
      payMana: true,
      manaCost: '{1}',
      cardName: 'Transguild Promenade',
    } as any);

    expect(((game.state as any).battlefield || []).map((perm: any) => perm.id)).toEqual(['promenade_1']);
    expect((game.state as any).zones[p1].graveyard || []).toEqual([]);
    expect((game.state as any).manaPool[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => String(entry?.id || '') === 'sacrifice_unless_pay_step_1')).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays sacrifice-unless-pay with Treasure-backed auto-pay by preserving the token graveyard snapshot', () => {
    const game = createInitialGameState('t_sacrifice_unless_pay_replay_treasure_pay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'promenade_1',
        controller: p1,
        owner: p1,
        tapped: true,
        card: {
          id: 'promenade_card',
          name: 'Transguild Promenade',
          type_line: 'Land',
          oracle_text: 'When Transguild Promenade enters the battlefield, sacrifice it unless you pay {1}.',
        },
      },
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
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };

    game.applyEvent({
      type: 'sacrificeUnlessPayChoice',
      playerId: p1,
      permanentId: 'promenade_1',
      payMana: true,
      manaCost: '{1}',
      cardName: 'Transguild Promenade',
      sacrificedPaymentPermanents: ['treasure_1'],
      paymentManaDelta: {},
    } as any);

    expect(((game.state as any).battlefield || []).map((perm: any) => perm.id)).toEqual(['promenade_1']);
    expect((((game.state as any).zones?.[p1]?.graveyard) || []).some((card: any) => card?.name === 'Treasure')).toBe(true);
    expect((game.state as any).manaPool[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('replays sacrifice-unless-pay decline by moving the permanent to graveyard', () => {
    const game = createInitialGameState('t_sacrifice_unless_pay_replay_decline');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'promenade_1',
        controller: p1,
        owner: p1,
        tapped: true,
        card: {
          id: 'promenade_card',
          name: 'Transguild Promenade',
          type_line: 'Land',
        },
      },
    ];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };

    game.applyEvent({
      type: 'sacrificeUnlessPayChoice',
      playerId: p1,
      permanentId: 'promenade_1',
      payMana: false,
      manaCost: '{1}',
      cardName: 'Transguild Promenade',
    } as any);

    expect(((game.state as any).battlefield || []).map((perm: any) => perm.id)).toEqual([]);
    expect(((game.state as any).zones[p1].graveyard || []).map((card: any) => card.name)).toEqual(['Transguild Promenade']);
  });

  it('replays reveal-land choice by untapping the land when a card was revealed', () => {
    const gameId = 't_reveal_land_choice_replay_reveal';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'snarl_1',
        controller: p1,
        owner: p1,
        tapped: true,
        card: { id: 'snarl_card', name: 'Shineshadow Snarl', type_line: 'Land' },
      },
    ];

    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.addStep(gameId, {
      id: 'reveal_land_choice_step_1',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Reveal a land?',
      mandatory: false,
      revealLandChoice: true,
      permanentId: 'snarl_1',
    } as any);

    game.applyEvent({
      type: 'revealLandChoice',
      playerId: p1,
      resolvedStepId: 'reveal_land_choice_step_1',
      permanentId: 'snarl_1',
      revealCardId: 'plains_hand_1',
      cardName: 'Shineshadow Snarl',
    } as any);

    expect(Boolean((game.state as any).battlefield[0]?.tapped)).toBe(false);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => String(entry?.id || '') === 'reveal_land_choice_step_1')).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays reveal-land decline by keeping the land tapped', () => {
    const game = createInitialGameState('t_reveal_land_choice_replay_decline');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'snarl_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { id: 'snarl_card', name: 'Shineshadow Snarl', type_line: 'Land' },
      },
    ];

    game.applyEvent({
      type: 'revealLandChoice',
      playerId: p1,
      permanentId: 'snarl_1',
      revealCardId: null,
      cardName: 'Shineshadow Snarl',
    } as any);

    expect(Boolean((game.state as any).battlefield[0]?.tapped)).toBe(true);
  });

  it('replays shock-land life payment as real life loss this turn', () => {
    const gameId = 't_shock_land_choice_replay_pay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).life = { [p1]: 40 };
    (game.state as any).battlefield = [
      {
        id: 'shock_1',
        controller: p1,
        owner: p1,
        tapped: true,
        card: { id: 'shock_card', name: 'Watery Grave', type_line: 'Land' },
      },
    ];

    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.addStep(gameId, {
      id: 'shock_land_choice_step_1',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Pay 2 life?',
      mandatory: false,
      shockLandChoice: true,
      permanentId: 'shock_1',
    } as any);

    game.applyEvent({
      type: 'shockLandChoice',
      playerId: p1,
      resolvedStepId: 'shock_land_choice_step_1',
      permanentId: 'shock_1',
      payLife: true,
      cardName: 'Watery Grave',
    } as any);

    expect((game.state as any).life?.[p1]).toBe(38);
    expect((game.state as any).players?.[0]?.life).toBe(38);
    expect((game.state as any).lifeLostThisTurn?.[p1]).toBe(2);
    expect(Boolean((game.state as any).battlefield[0]?.tapped)).toBe(false);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => String(entry?.id || '') === 'shock_land_choice_step_1')).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays shock-land decline by keeping the land tapped without losing life', () => {
    const game = createInitialGameState('t_shock_land_choice_replay_decline');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).life = { [p1]: 40 };
    (game.state as any).battlefield = [
      {
        id: 'shock_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { id: 'shock_card', name: 'Watery Grave', type_line: 'Land' },
      },
    ];

    game.applyEvent({
      type: 'shockLandChoice',
      playerId: p1,
      permanentId: 'shock_1',
      payLife: false,
      cardName: 'Watery Grave',
    } as any);

    expect((game.state as any).life?.[p1]).toBe(40);
    expect((game.state as any).lifeLostThisTurn?.[p1] ?? 0).toBe(0);
    expect(Boolean((game.state as any).battlefield[0]?.tapped)).toBe(true);
  });
});