import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: "if an opponent cast a blue and/or black spell this turn"', () => {
  it('is true if an opponent cast a blue spell this turn', () => {
    const g = createInitialGameState('t_if_opponent_cast_ub_true');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

    (g as any).state.spellsCastThisTurn = [
      {
        casterId: String(p2),
        card: { colors: ['U'], type_line: 'Instant' },
      },
    ];

    expect(
      evaluateInterveningIfClause(g as any, String(p1), 'if an opponent cast a blue and/or black spell this turn')
    ).toBe(true);
  });

  it('is false if only non-blue/non-black opponent spells were cast this turn', () => {
    const g = createInitialGameState('t_if_opponent_cast_ub_false');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

    (g as any).state.spellsCastThisTurn = [
      {
        casterId: String(p2),
        card: { colors: ['R'], type_line: 'Instant' },
      },
      {
        casterId: String(p2),
        card: { colors: [], type_line: 'Artifact' },
      },
    ];

    expect(
      evaluateInterveningIfClause(g as any, String(p1), 'if an opponent cast a blue and/or black spell this turn')
    ).toBe(false);
  });

  it('is null if opponent spell colors are unknown and none are known to qualify', () => {
    const g = createInitialGameState('t_if_opponent_cast_ub_null');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

    (g as any).state.spellsCastThisTurn = [
      {
        casterId: String(p2),
        // No colors field at all -> unknown
        card: { type_line: 'Instant' },
      },
    ];

    expect(
      evaluateInterveningIfClause(g as any, String(p1), 'if an opponent cast a blue and/or black spell this turn')
    ).toBe(null);
  });

  it('ignores spells cast by you', () => {
    const g = createInitialGameState('t_if_opponent_cast_ub_ignores_self');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    (g as any).state.spellsCastThisTurn = [
      {
        casterId: String(p1),
        card: { colors: ['U'], type_line: 'Instant' },
      },
    ];

    expect(
      evaluateInterveningIfClause(g as any, String(p1), 'if an opponent cast a blue and/or black spell this turn')
    ).toBe(false);
  });
});
