import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: "those creatures" attack group context', () => {
  const clause = 'if two or more of those creatures are attacking you and/or planeswalkers you control';

  it('returns true when threshold is met via player + planeswalker attacks', () => {
    const g = createInitialGameState('t_attack_group_true');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state.battlefield as any[]).push(
      {
        id: 'pw_1',
        controller: p2,
        owner: p2,
        card: { id: 'pw_card', name: 'Test Walker', type_line: 'Legendary Planeswalker — Test', oracle_text: '' },
      },
      {
        id: 'a1',
        controller: p1,
        owner: p1,
        attacking: p2,
        card: { id: 'a1_card', name: 'Attacker 1', type_line: 'Creature', oracle_text: '' },
      },
      {
        id: 'a2',
        controller: p1,
        owner: p1,
        attacking: 'pw_1',
        card: { id: 'a2_card', name: 'Attacker 2', type_line: 'Creature', oracle_text: '' },
      },
      {
        id: 'a3',
        controller: p1,
        owner: p1,
        attacking: p1,
        card: { id: 'a3_card', name: 'Attacker 3', type_line: 'Creature', oracle_text: '' },
      }
    );

    expect(
      evaluateInterveningIfClause(g as any, String(p2), clause, undefined, {
        thoseCreatureIds: ['a1', 'a2', 'a3'],
      })
    ).toBe(true);
  });

  it('returns false when threshold cannot be met (no unknowns)', () => {
    const g = createInitialGameState('t_attack_group_false');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state.battlefield as any[]).push(
      {
        id: 'pw_1',
        controller: p2,
        owner: p2,
        card: { id: 'pw_card', name: 'Test Walker', type_line: 'Planeswalker — Test', oracle_text: '' },
      },
      {
        id: 'a1',
        controller: p1,
        owner: p1,
        attacking: p2,
        card: { id: 'a1_card', name: 'Attacker 1', type_line: 'Creature', oracle_text: '' },
      },
      {
        id: 'a2',
        controller: p1,
        owner: p1,
        attacking: p1,
        card: { id: 'a2_card', name: 'Attacker 2', type_line: 'Creature', oracle_text: '' },
      }
    );

    expect(
      evaluateInterveningIfClause(g as any, String(p2), clause, undefined, {
        thoseCreatureIds: ['a1', 'a2'],
      })
    ).toBe(false);
  });

  it('returns null when outcome depends on unknown attacker targets', () => {
    const g = createInitialGameState('t_attack_group_null');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state.battlefield as any[]).push({
      id: 'a1',
      controller: p1,
      owner: p1,
      attacking: p2,
      card: { id: 'a1_card', name: 'Attacker 1', type_line: 'Creature', oracle_text: '' },
    });

    // a2 is missing from battlefield => unknown.
    expect(
      evaluateInterveningIfClause(g as any, String(p2), clause, undefined, {
        thoseCreatureIds: ['a1', 'a2'],
      })
    ).toBe(null);
  });
});
