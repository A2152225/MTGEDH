import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';

describe('untap step effects', () => {
  it('applies Unwinding Clock during another player\'s untap step without reopening player actions', () => {
    const game = createInitialGameState('t_unwinding_clock_other_player_untap');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UNTAP';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'p1_land',
        controller: p1,
        owner: p1,
        tapped: true,
        card: {
          id: 'p1_land_card',
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '',
        },
      },
      {
        id: 'unwinding_clock',
        controller: p2,
        owner: p2,
        tapped: true,
        card: {
          id: 'unwinding_clock_card',
          name: 'Unwinding Clock',
          type_line: 'Artifact',
          oracle_text: "Untap all artifacts you control during each other player's untap step.",
        },
      },
      {
        id: 'mana_rock',
        controller: p2,
        owner: p2,
        tapped: true,
        card: {
          id: 'mana_rock_card',
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}{C}.',
        },
      },
      {
        id: 'bear',
        controller: p2,
        owner: p2,
        tapped: true,
        card: {
          id: 'bear_card',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      },
    ];

    game.applyEvent({ type: 'nextStep' });

    const battlefield = (game.state as any).battlefield || [];
    const p1Land = battlefield.find((permanent: any) => permanent?.id === 'p1_land');
    const clock = battlefield.find((permanent: any) => permanent?.id === 'unwinding_clock');
    const manaRock = battlefield.find((permanent: any) => permanent?.id === 'mana_rock');
    const bear = battlefield.find((permanent: any) => permanent?.id === 'bear');

    expect(String((game.state as any).step || '').toUpperCase()).toBe('UPKEEP');
    expect(p1Land?.tapped).toBe(false);
    expect(clock?.tapped).toBe(false);
    expect(manaRock?.tapped).toBe(false);
    expect(bear?.tapped).toBe(true);
  });
});