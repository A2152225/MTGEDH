import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: "if a +1/+1 counter was put on a permanent under your control this turn"', () => {
  it('is false before any +1/+1 counters are placed', () => {
    const g = createInitialGameState('t_if_p1p1_counter_none');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    (g.state as any).putPlusOneCounterOnPermanentThisTurn = { [String(p1)]: false };

    expect(
      evaluateInterveningIfClause(
        g as any,
        String(p1),
        'if a +1/+1 counter was put on a permanent under your control this turn'
      )
    ).toBe(false);
  });

  it('becomes true when +1/+1 counters are added to a permanent you control via updateCounters', () => {
    const g = createInitialGameState('t_if_p1p1_counter_true');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    (g.state.battlefield as any[]).push({
      id: 'perm_1',
      controller: p1,
      owner: p1,
      card: { id: 'c1', name: 'Vanilla', type_line: 'Artifact', oracle_text: '' },
    });

    // Ensure tracker object exists; updateCounters should flip it to true.
    (g.state as any).putPlusOneCounterOnPermanentThisTurn = { [String(p1)]: false };

    g.updateCounters('perm_1', { '+1/+1': 1 });

    expect(((g.state as any).putPlusOneCounterOnPermanentThisTurn || {})[String(p1)]).toBe(true);
    expect(
      evaluateInterveningIfClause(
        g as any,
        String(p1),
        'if a +1/+1 counter was put on a permanent under your control this turn'
      )
    ).toBe(true);
  });

  it('is false when +1/+1 counters are placed, but only on an opponent-controlled permanent', () => {
    const g = createInitialGameState('t_if_p1p1_counter_opponent_only');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

    (g.state.battlefield as any[]).push({
      id: 'perm_2',
      controller: p2,
      owner: p2,
      card: { id: 'c2', name: 'Opponent Permanent', type_line: 'Creature', oracle_text: '' },
    });

    (g.state as any).putPlusOneCounterOnPermanentThisTurn = { [String(p1)]: false, [String(p2)]: false };

    g.updateCounters('perm_2', { '+1/+1': 1 });

    expect(
      evaluateInterveningIfClause(
        g as any,
        String(p1),
        'if a +1/+1 counter was put on a permanent under your control this turn'
      )
    ).toBe(false);
  });

  it('is null when tracking is missing', () => {
    const g = createInitialGameState('t_if_p1p1_counter_null');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    delete (g.state as any).putPlusOneCounterOnPermanentThisTurn;

    expect(
      evaluateInterveningIfClause(
        g as any,
        String(p1),
        'if a +1/+1 counter was put on a permanent under your control this turn'
      )
    ).toBe(null);
  });
});
