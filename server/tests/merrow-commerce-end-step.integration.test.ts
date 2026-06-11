import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('Merrow Commerce end step untap', () => {
  it('untaps only Merfolk permanents, not lands', () => {
    const gameId = 't_merrow_commerce_end_step';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const merrowCommerceId = 'merrow_commerce_1';
    const merfolkId = 'merfolk_1';
    const forestId = 'forest_1';

    (game.state as any).battlefield = [
      {
        id: merrowCommerceId,
        controller: p1,
        owner: p1,
        tapped: true,
        card: {
          id: 'card_merrow_commerce',
          name: 'Merrow Commerce',
          type_line: 'Kindred Enchantment — Merfolk',
          oracle_text: 'At the beginning of your end step, untap all Merfolk you control.',
        },
      },
      {
        id: merfolkId,
        controller: p1,
        owner: p1,
        tapped: true,
        card: {
          id: 'card_merfolk',
          name: 'Merfolk Looter',
          type_line: 'Creature — Merfolk',
        },
      },
      {
        id: forestId,
        controller: p1,
        owner: p1,
        tapped: true,
        card: {
          id: 'card_forest',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
        },
      },
    ];

    executeTriggerEffect(
      (game as any).ctx || game,
      p1,
      'Merrow Commerce',
      'untap all Merfolk you control',
      {
        source: merrowCommerceId,
        permanentId: merrowCommerceId,
        triggerType: 'end_step_effect',
      },
    );

    const battlefield = (game.state as any).battlefield as any[];
    const merrowCommerce = battlefield.find((perm) => perm.id === merrowCommerceId);
    const merfolk = battlefield.find((perm) => perm.id === merfolkId);
    const forest = battlefield.find((perm) => perm.id === forestId);

    expect(merrowCommerce?.tapped).toBe(false);
    expect(merfolk?.tapped).toBe(false);
    expect(forest?.tapped).toBe(true);
  });
});
