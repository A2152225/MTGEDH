import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';

describe('replay(nextStep) turn advancement determinism', () => {
  it('advances the turn during replay when nextStep reaches cleanup and no nextTurn event follows', () => {
    const g = createInitialGameState('replay_nextstep_advances_turn');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' } as any);
    g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' } as any);

    (g.state as any).turnPlayer = p1;
    (g.state as any).turnNumber = 1;
    (g.state as any).phase = 'ending';
    (g.state as any).step = 'END';
    (g.state as any).stack = [];
    (g.state as any).battlefield = [];

    // Replay a single nextStep event.
    g.replay([{ type: 'nextStep' } as any]);

    expect((g.state as any).turnNumber).toBe(2);
    expect((g.state as any).turnPlayer).toBe(p2);
  });

  it('does not double-advance when an explicit nextTurn event follows nextStep during replay', () => {
    const g = createInitialGameState('replay_nextstep_then_nextturn_no_double');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' } as any);
    g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' } as any);

    (g.state as any).turnPlayer = p1;
    (g.state as any).turnNumber = 1;
    (g.state as any).phase = 'ending';
    (g.state as any).step = 'END';
    (g.state as any).stack = [];
    (g.state as any).battlefield = [];

    // Replay nextStep followed immediately by nextTurn.
    g.replay([{ type: 'nextStep' } as any, { type: 'nextTurn', by: p1 } as any]);

    expect((g.state as any).turnNumber).toBe(2);
    expect((g.state as any).turnPlayer).toBe(p2);
  });
});
