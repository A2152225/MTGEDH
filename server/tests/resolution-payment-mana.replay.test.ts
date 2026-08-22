import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('undo/replay Medium #6: resolution payment mana taps / pool mutations', () => {
  it('replays permanent_tapped from resolution payment without changing mana', () => {
    const game = createInitialGameState('t_resolution_payment_permanent_tapped_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [
      {
        id: 'forest_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'forest_card_1',
          name: 'Forest',
          type_line: 'Basic Land - Forest',
          oracle_text: '{T}: Add {G}.',
          zone: 'battlefield',
        },
      },
      {
        id: 'island_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'island_card_1',
          name: 'Island',
          type_line: 'Basic Land - Island',
          oracle_text: '{T}: Add {U}.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'permanent_tapped',
      playerId: p1,
      permanentIds: ['forest_1', 'island_1'],
      reason: 'resolution_mana_payment',
    } as any);

    const bf = (game.state as any).battlefield || [];
    expect(bf.find((p: any) => p.id === 'forest_1')?.tapped).toBe(true);
    expect(bf.find((p: any) => p.id === 'island_1')?.tapped).toBe(true);
    expect((game.state as any).manaPool?.[p1]).toEqual({
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 1,
    });
  });

  it('replays addManaToPool / removeManaFromPool payment deltas exactly', () => {
    const game = createInitialGameState('t_resolution_payment_mana_pool_delta_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
    };

    game.applyEvent({
      type: 'addManaToPool',
      playerId: p1,
      color: 'green',
      amount: 1,
      reason: 'resolution_mana_payment',
    } as any);
    game.applyEvent({
      type: 'removeManaFromPool',
      playerId: p1,
      color: 'blue',
      amount: 1,
      reason: 'resolution_mana_payment',
    } as any);
    game.applyEvent({
      type: 'removeManaFromPool',
      playerId: p1,
      color: 'green',
      amount: 1,
      reason: 'resolution_mana_payment',
    } as any);
    game.applyEvent({
      type: 'removeManaFromPool',
      playerId: p1,
      color: 'colorless',
      amount: 1,
      reason: 'resolution_mana_payment',
    } as any);

    expect((game.state as any).manaPool?.[p1]).toEqual({
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 1,
    });
  });

  it('new-style ward payment stream: discrete tap/mana events then thin wardPaymentResolve', () => {
    const game = createInitialGameState('t_ward_payment_discrete_then_resolve');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).battlefield = [
      {
        id: 'plains_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'plains_card_1',
          name: 'Plains',
          type_line: 'Basic Land - Plains',
          oracle_text: '{T}: Add {W}.',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'spell_1',
        type: 'spell',
        controller: p1,
        sourceName: 'Bolt',
        targets: [],
        card: { id: 'spell_card_1', name: 'Bolt', type_line: 'Instant', zone: 'stack' },
      },
    ];

    game.applyEvent({
      type: 'permanent_tapped',
      playerId: p1,
      permanentIds: ['plains_1'],
      reason: 'resolution_mana_payment',
    } as any);
    game.applyEvent({
      type: 'removeManaFromPool',
      playerId: p1,
      color: 'colorless',
      amount: 2,
      reason: 'resolution_mana_payment',
    } as any);
    game.applyEvent({
      type: 'wardPaymentResolve',
      playerId: p1,
      stepId: 'ward_step_1',
      sourceId: 'spell_1',
      wardCost: '{2}',
      wardPermanentId: 'ward_perm_1',
      wardPermanentName: 'Guarded Bear',
      wardPaymentType: 'mana',
      paymentMutationsPersistedSeparately: true,
    } as any);

    expect((game.state as any).battlefield.find((p: any) => p.id === 'plains_1')?.tapped).toBe(true);
    expect((game.state as any).manaPool?.[p1]?.colorless).toBe(0);
  });

  it('legacy wardPaymentResolve payload still restores taps + mana when fields are present', () => {
    const game = createInitialGameState('t_ward_payment_legacy_fields_still_apply');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).battlefield = [
      {
        id: 'plains_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'plains_card_1',
          name: 'Plains',
          type_line: 'Basic Land - Plains',
          oracle_text: '{T}: Add {W}.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'wardPaymentResolve',
      playerId: p1,
      stepId: 'ward_step_1',
      sourceId: 'spell_1',
      wardCost: '{2}',
      wardPermanentId: 'ward_perm_1',
      wardPermanentName: 'Guarded Bear',
      wardPaymentType: 'mana',
      tappedPermanents: ['plains_1'],
      paymentManaDelta: { colorless: -2 },
    } as any);

    expect((game.state as any).battlefield.find((p: any) => p.id === 'plains_1')?.tapped).toBe(true);
    expect((game.state as any).manaPool?.[p1]?.colorless).toBe(0);
  });
});
