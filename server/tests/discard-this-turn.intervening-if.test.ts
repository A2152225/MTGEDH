import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: discard this turn', () => {
  it('returns null when discard tracking is missing', () => {
    const g = createInitialGameState('t_if_discard_missing');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if a player discarded a card this turn')).toBe(null);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you discarded a card this turn')).toBe(null);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if an opponent discarded a card this turn')).toBe(null);
  });

  it('evaluates using discardedCardThisTurn map (opponent-aware)', () => {
    const g = createInitialGameState('t_if_discard_map');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

    (g.state as any).discardedCardThisTurn = { [p1]: true, [p2]: false };

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if a player discarded a card this turn')).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you discarded a card this turn')).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if an opponent discarded a card this turn')).toBe(false);

    expect(evaluateInterveningIfClause(g as any, String(p2), 'if you discarded a card this turn')).toBe(false);
    expect(evaluateInterveningIfClause(g as any, String(p2), 'if an opponent discarded a card this turn')).toBe(true);
  });

  it('tracks discard via cleanupDiscard and additionalCostConfirm', () => {
    const g = createInitialGameState('t_if_discard_apply_event');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

    // Initialize per-turn tracking like nextTurn() would.
    (g.state as any).discardedCardThisTurn = { [p1]: false, [p2]: false };
    (g.state as any).anyPlayerDiscardedCardThisTurn = false;

    // p1 discards during cleanup
    (g.state as any).zones[p1].hand.push({ id: 'c1', name: 'Test Card 1', type_line: 'Sorcery', oracle_text: '' });
    (g.state as any).zones[p1].handCount = (g.state as any).zones[p1].hand.length;
    g.applyEvent({ type: 'cleanupDiscard', playerId: p1, cardIds: ['c1'] } as any);

    expect((g.state as any).discardedCardThisTurn[p1]).toBe(true);
    expect((g.state as any).anyPlayerDiscardedCardThisTurn).toBe(true);

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you discarded a card this turn')).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p2), 'if an opponent discarded a card this turn')).toBe(true);

    // p2 discards as an additional cost
    (g.state as any).zones[p2].hand.push({ id: 'c2', name: 'Test Card 2', type_line: 'Instant', oracle_text: '' });
    (g.state as any).zones[p2].handCount = (g.state as any).zones[p2].hand.length;
    g.applyEvent({ type: 'additionalCostConfirm', playerId: p2, costType: 'discard', selectedCards: ['c2'] } as any);

    expect((g.state as any).discardedCardThisTurn[p2]).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p2), 'if you discarded a card this turn')).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if an opponent discarded a card this turn')).toBe(true);
  });
});
