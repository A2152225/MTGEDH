import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name } as any);
}

describe('Intervening-if: opponents control none', () => {
  it('evaluates "if your opponents control no creatures"', () => {
    const g = createInitialGameState('t_if_no_opp_creatures');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if your opponents control no creatures')).toBe(true);

    (g.state.battlefield as any[]).push({
      id: 'opp_creature',
      controller: p2,
      owner: p2,
      card: { id: 'c', name: 'Opp Creature', type_line: 'Creature — Test', oracle_text: '' },
    });

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if your opponents control no creatures')).toBe(false);
  });
});
