import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: "if you gained and lost life this turn"', () => {
  it('is false with no life changes', () => {
    const g = createInitialGameState('t_if_gained_and_lost_none');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you gained and lost life this turn')).toBe(false);
  });

  it('is false if you only gained life', () => {
    const g = createInitialGameState('t_if_gained_and_lost_gain_only');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    g.applyEvent({ type: 'setLife', playerId: p1, delta: 2 } as any);

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you gained and lost life this turn')).toBe(false);
  });

  it('is false if you only lost life', () => {
    const g = createInitialGameState('t_if_gained_and_lost_loss_only');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    g.applyEvent({ type: 'setLife', playerId: p1, delta: -1 } as any);

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you gained and lost life this turn')).toBe(false);
  });

  it('is true if you gained and lost life (in any order)', () => {
    const g = createInitialGameState('t_if_gained_and_lost_true');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    g.applyEvent({ type: 'setLife', playerId: p1, delta: 2 } as any);
    g.applyEvent({ type: 'setLife', playerId: p1, delta: -1 } as any);

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you gained and lost life this turn')).toBe(true);
  });
});
