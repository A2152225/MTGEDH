import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';

describe('Intervening-if upkeep triggers', () => {
  it('does not put Emeria, the Sky Ruin trigger on the stack when Plains condition is false', () => {
    const g = createInitialGameState('t_intervening_if_emeria');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Provide decks so draw step can function in other tests; not strictly needed here.
    const sampleDeck = Array.from({ length: 10 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.importDeckResolved(p2, sampleDeck);

    // Start the game: turnPlayer becomes p2 at UNTAP.
    g.applyEvent({ type: 'nextTurn' });
    expect(g.state.turnPlayer).toBe(p2);

    // Put Emeria on the battlefield for p2.
    (g.state.battlefield as any).push({
      id: 'em_1',
      controller: p2,
      owner: p2,
      card: {
        id: 'em_card',
        name: 'Emeria, the Sky Ruin',
        type_line: 'Land',
        oracle_text:
          'Emeria, the Sky Ruin enters tapped.\n' +
          'At the beginning of your upkeep, if you control seven or more Plains, you may return target creature card from your graveyard to the battlefield.\n' +
          '{T}: Add {W}.',
      },
      tapped: false,
    });

    // Add only 6 Plains (Emeria requires 7+ Plains).
    for (let i = 0; i < 6; i++) {
      (g.state.battlefield as any).push({
        id: `pl_${i}`,
        controller: p2,
        owner: p2,
        card: {
          id: `pl_card_${i}`,
          name: 'Plains',
          type_line: 'Basic Land — Plains',
          oracle_text: '{T}: Add {W}.',
        },
        tapped: false,
      });
    }

    // Advance to upkeep (enterUpkeepStep runs here).
    g.applyEvent({ type: 'nextStep' });

    const stack = (g.state.stack || []) as any[];
    const emeriaTrigger = stack.find((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Emeria, the Sky Ruin');
    expect(emeriaTrigger).toBeUndefined();
  });

  it('does not put "if you control no Snakes" each-upkeep trigger on stack when condition is false', () => {
    const g = createInitialGameState('t_intervening_if_ophiomancer');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const sampleDeck = Array.from({ length: 10 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.importDeckResolved(p2, sampleDeck);

    // Start the game: turnPlayer becomes p2 at UNTAP.
    g.applyEvent({ type: 'nextTurn' });
    expect(g.state.turnPlayer).toBe(p2);

    // Ophiomancer (triggers at beginning of each upkeep, if you control no Snakes...)
    (g.state.battlefield as any).push({
      id: 'oph_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'oph_card',
        name: 'Ophiomancer',
        type_line: 'Creature — Human Shaman',
        oracle_text:
          'At the beginning of each upkeep, if you control no Snakes, create a 1/1 black Snake creature token with deathtouch.',
      },
      tapped: false,
    });

    // Ensure p1 DOES control a Snake.
    (g.state.battlefield as any).push({
      id: 'snake_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'snake_card',
        name: 'Snake',
        type_line: 'Token Creature — Snake',
        oracle_text: 'Deathtouch',
      },
      tapped: false,
    });

    // Advance to upkeep for p2 (Ophiomancer would normally trigger here).
    g.applyEvent({ type: 'nextStep' });

    const stack = (g.state.stack || []) as any[];
    const ophiomancerTrigger = stack.find((s) => s?.type === 'triggered_ability' && s?.sourceName === 'Ophiomancer');
    expect(ophiomancerTrigger).toBeUndefined();
  });
});
