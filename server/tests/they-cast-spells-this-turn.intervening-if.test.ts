import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name } as any);
}

describe('Intervening-if: "they cast N or more spells this turn"', () => {
  it('uses refs.theirPlayerId to count spells cast this turn', () => {
    const g = createInitialGameState('t_if_they_cast');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const clause = 'if they cast four or more spells this turn';

    (g.state as any).spellsCastThisTurn = [
      { casterId: p2, card: { name: 'A', type_line: 'Instant' } },
      { casterId: p2, card: { name: 'B', type_line: 'Sorcery' } },
      { casterId: p2, card: { name: 'C', type_line: 'Instant' } },
    ];
    expect(evaluateInterveningIfClause(g as any, String(p1), clause, undefined, { theirPlayerId: p2 } as any)).toBe(false);

    (g.state as any).spellsCastThisTurn.push({ casterId: p2, card: { name: 'D', type_line: 'Instant' } });
    expect(evaluateInterveningIfClause(g as any, String(p1), clause, undefined, { theirPlayerId: p2 } as any)).toBe(true);

    // Missing refs => conservative unknown.
    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(null);
  });
});
