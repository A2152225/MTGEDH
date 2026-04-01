import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';

function setupToMain1(game: ReturnType<typeof createInitialGameState>, p1: PlayerID, p2: PlayerID) {
  game.applyEvent({ type: 'nextTurn' });

  const p1Deck = Array.from({ length: 20 }, (_, index) => ({
    id: `p1_card_${index}`,
    name: `P1 Card ${index}`,
    type_line: 'Creature',
    oracle_text: '',
  }));
  const p2Deck = Array.from({ length: 20 }, (_, index) => ({
    id: `p2_card_${index}`,
    name: `P2 Card ${index}`,
    type_line: 'Creature',
    oracle_text: '',
  }));

  game.importDeckResolved(p1, p1Deck);
  game.importDeckResolved(p2, p2Deck);

  game.applyEvent({ type: 'nextStep' });
  game.applyEvent({ type: 'nextStep' });
  game.applyEvent({ type: 'nextStep' });
}

describe('Sokrates combat damage replacement', () => {
  it('prevents combat damage from a granted ability and makes both players draw half that much, rounded down', () => {
    const game = createInitialGameState('sokrates_combat_replacement');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    setupToMain1(game, p1, p2);

    const active = game.state.turnPlayer as PlayerID;
    const defending = active === p1 ? p2 : p1;

    const attacker = {
      id: 'attacker_1',
      controller: active,
      owner: active,
      tapped: false,
      counters: {},
      summoningSickness: false,
      basePower: 5,
      baseToughness: 5,
      temporaryAbilities: [
        {
          ability: "if this creature would deal combat damage to a player, prevent that damage. this creature's controller and that player each draw half that many cards, rounded down.",
          source: 'Sokrates, Athenian Teacher',
          expiresAt: 'end_of_turn',
          turnApplied: (game.state as any).turnNumber || 0,
        },
      ],
      card: {
        id: 'attacker_card_1',
        name: 'Gifted Attacker',
        type_line: 'Creature — Human',
        oracle_text: '',
        power: '5',
        toughness: '5',
      },
    };

    (game.state.battlefield as any[]).push(attacker as any);

    const startingLife = Number((game.state as any).life?.[defending] ?? 40);
    const attackerHandBefore = Number((game.state as any).zones?.[active]?.handCount ?? 0);
    const defendingHandBefore = Number((game.state as any).zones?.[defending]?.handCount ?? 0);

    game.applyEvent({ type: 'nextStep' });
    game.applyEvent({ type: 'nextStep' });
    game.applyEvent({ type: 'nextStep' });

    (attacker as any).attacking = defending;
    (attacker as any).blockedBy = [];

    game.applyEvent({ type: 'nextStep' });

    const defendingLifeAfter = Number((game.state as any).life?.[defending] ?? 40);
    const attackerHandAfter = Number((game.state as any).zones?.[active]?.handCount ?? 0);
    const defendingHandAfter = Number((game.state as any).zones?.[defending]?.handCount ?? 0);

    expect(defendingLifeAfter).toBe(startingLife);
    expect(attackerHandAfter - attackerHandBefore).toBe(2);
    expect(defendingHandAfter - defendingHandBefore).toBe(2);
  });
});