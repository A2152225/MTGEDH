import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('exchangeTextBoxes replay semantics', () => {
  it('replays persisted text-box swaps on battlefield permanents', () => {
    const game = createInitialGameState('t_exchange_text_boxes_replay');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    const deadpoolText = [
      'As Deadpool enters, you may exchange his text box and another creature’s.',
      'At the beginning of your upkeep, you lose 3 life.',
      '{3}, Sacrifice this creature: Each other player draws a card.',
    ].join('\n');

    (game.state as any).battlefield = [
      {
        id: 'deadpool_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        summoningSickness: false,
        card: {
          id: 'deadpool_card',
          name: 'Deadpool, Trading Card',
          type_line: 'Creature — Human',
          oracle_text: deadpoolText,
          zone: 'battlefield',
        },
      },
      {
        id: 'target_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        summoningSickness: false,
        card: {
          id: 'target_card',
          name: 'Sky Drake',
          type_line: 'Creature — Drake',
          oracle_text: 'Flying',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'exchangeTextBoxes',
      playerId: p1,
      sourcePermanentId: 'deadpool_perm',
      targetPermanentId: 'target_perm',
    } as any);

    const source = (game.state as any).battlefield.find((perm: any) => perm.id === 'deadpool_perm');
    const target = (game.state as any).battlefield.find((perm: any) => perm.id === 'target_perm');

    expect(source.card.oracle_text).toBe('Flying');
    expect((source as any).oracle_text).toBe('Flying');
    expect(target.card.oracle_text).toBe(deadpoolText);
    expect((target as any).oracle_text).toBe(deadpoolText);
  });
});