import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name } as any);
}

describe('Intervening-if: attacked/blocked flags', () => {
  it('evaluates "if this creature attacked this turn" (best-effort)', () => {
    const g = createInitialGameState('t_if_attacked');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const noInfo = { id: 'c0', controller: p1, owner: p1, card: { id: 'c0c', name: 'NoInfo', type_line: 'Creature', oracle_text: '' } };
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature attacked this turn', noInfo as any)).toBe(null);

    const notAttacked = { ...noInfo, id: 'c1', attackedThisTurn: false };
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature attacked this turn', notAttacked as any)).toBe(false);

    const attacked = { ...noInfo, id: 'c2', attackedThisTurn: true };
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature attacked this turn', attacked as any)).toBe(true);
  });

  it('evaluates "if this creature attacked or blocked this turn" (best-effort)', () => {
    const g = createInitialGameState('t_if_attacked_or_blocked');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const attacked = { id: 'c1', controller: p1, owner: p1, attackedThisTurn: true, card: { id: 'c', name: 'A', type_line: 'Creature', oracle_text: '' } };
    const blocked = { id: 'c2', controller: p1, owner: p1, blockedThisTurn: true, card: { id: 'c', name: 'B', type_line: 'Creature', oracle_text: '' } };
    const none = { id: 'c3', controller: p1, owner: p1, attackedThisTurn: false, blockedThisTurn: false, card: { id: 'c', name: 'C', type_line: 'Creature', oracle_text: '' } };

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature attacked or blocked this turn', attacked as any)).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature attacked or blocked this turn', blocked as any)).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature attacked or blocked this turn', none as any)).toBe(false);
  });

  it('evaluates "if this Vehicle attacked or blocked this combat" (best-effort)', () => {
    const g = createInitialGameState('t_if_vehicle_combat');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const vehicle = {
      id: 'v1',
      controller: p1,
      owner: p1,
      attackedThisTurn: true,
      card: { id: 'vc', name: 'Vehicle', type_line: 'Artifact — Vehicle', oracle_text: '' },
    };

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this Vehicle attacked or blocked this combat', vehicle as any)).toBe(true);
  });
});
