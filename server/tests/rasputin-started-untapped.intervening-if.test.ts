import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: Rasputin started the turn untapped', () => {
  const clause = 'if Rasputin started the turn untapped';

  it('returns null when no snapshot exists and no explicit boolean is present', () => {
    const g = createInitialGameState('t_rasputin_started_untapped_null') as any;
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state.battlefield as any[]).push({
      id: 'rasp_1',
      controller: p1,
      owner: p1,
      tapped: false,
      card: { name: 'Rasputin, the One True Tsar', type_line: 'Legendary Creature' },
    });

    expect(evaluateInterveningIfClause(g as any, String(p1), clause, { id: 'rasp_1' } as any)).toBe(null);
  });

  it('uses nextTurn snapshot to return true/false deterministically', () => {
    const g = createInitialGameState('t_rasputin_started_untapped_snapshot') as any;
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state.battlefield as any[]).push({
      id: 'rasp_1',
      controller: p1,
      owner: p1,
      tapped: false,
      card: { name: 'Rasputin, the One True Tsar', type_line: 'Legendary Creature' },
    });

    g.applyEvent({ type: 'nextTurn' } as any);
    expect((g.state as any).permanentUntappedAtTurnBegin?.rasp_1).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), clause, { id: 'rasp_1' } as any)).toBe(true);

    // If the snapshot says it was tapped at turn begin, the clause is false.
    (g.state as any).permanentUntappedAtTurnBegin.rasp_1 = false;
    expect(evaluateInterveningIfClause(g as any, String(p1), clause, { id: 'rasp_1' } as any)).toBe(false);
  });

  it('returns false when snapshot exists but permanent id is missing (not on battlefield at turn begin)', () => {
    const g: any = { state: { permanentUntappedAtTurnBegin: {} } };
    expect(evaluateInterveningIfClause(g, 'p1', clause, { id: 'rasp_1' } as any)).toBe(false);
  });
});
