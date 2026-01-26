import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: "if you drew two or more cards this turn"', () => {
  it('is false before any draws', () => {
    const g = createInitialGameState('t_if_drew_two_pre');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you drew two or more cards this turn')).toBe(false);
  });

  it('becomes true after drawing 2+ cards', () => {
    const g = createInitialGameState('t_if_drew_two_true');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

    g.importDeckResolved(p1, [
      { id: 'c1', name: 'Card 1', type_line: 'Instant', oracle_text: '' },
      { id: 'c2', name: 'Card 2', type_line: 'Instant', oracle_text: '' },
      { id: 'c3', name: 'Card 3', type_line: 'Instant', oracle_text: '' },
    ] as any);

    g.drawCards(p1, 2);

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you drew two or more cards this turn')).toBe(true);
  });

  it('is false after drawing only 1 card', () => {
    const g = createInitialGameState('t_if_drew_two_false');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    g.importDeckResolved(p1, [
      { id: 'c1', name: 'Card 1', type_line: 'Instant', oracle_text: '' },
      { id: 'c2', name: 'Card 2', type_line: 'Instant', oracle_text: '' },
    ] as any);

    g.drawCards(p1, 1);

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you drew two or more cards this turn')).toBe(false);
  });
});
