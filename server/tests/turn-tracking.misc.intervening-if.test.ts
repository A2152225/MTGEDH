import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: additional turn-tracking clauses', () => {
  it('evaluates "if you didn\'t play a card from exile this turn" using playedCardFromExileThisTurn', () => {
    const g = createInitialGameState('t_if_not_played_from_exile');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state as any).playedCardFromExileThisTurn = { [p1]: false };
    expect(evaluateInterveningIfClause(g as any, String(p1), "if you didn't play a card from exile this turn")).toBe(true);

    (g.state as any).playedCardFromExileThisTurn = { [p1]: true };
    expect(evaluateInterveningIfClause(g as any, String(p1), "if you didn't play a card from exile this turn")).toBe(false);
  });

  it('evaluates dungeon completion clauses from tracked completion flags', () => {
    const g = createInitialGameState('t_if_completed_dungeon');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state as any).completedDungeon = { [p1]: false };
    (g.state as any).completedDungeonThisTurn = { [p1]: false };

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you completed a dungeon')).toBe(false);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you completed a dungeon this turn')).toBe(false);

    (g.state as any).completedDungeon = { [p1]: true };
    (g.state as any).completedDungeonThisTurn = { [p1]: true };

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you completed a dungeon')).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you completed a dungeon this turn')).toBe(true);
  });

  it('evaluates "if you haven\'t completed Tomb of Annihilation" when completed dungeon names are tracked', () => {
    const g = createInitialGameState('t_if_not_completed_tomb');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state as any).completedDungeonNames = { [p1]: ['Lost Mine of Phandelver'] };
    expect(evaluateInterveningIfClause(g as any, String(p1), "if you haven't completed Tomb of Annihilation")).toBe(true);

    (g.state as any).completedDungeonNames = { [p1]: ['Tomb of Annihilation'] };
    expect(evaluateInterveningIfClause(g as any, String(p1), "if you haven't completed Tomb of Annihilation")).toBe(false);
  });

  it('tracks sacrificed Clues this turn via sacrificePermanent and evaluates threshold clause', () => {
    const g = createInitialGameState('t_if_sacrificed_clues');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state as any).sacrificedCluesThisTurn = { [p1]: 0 };

    (g.state.battlefield as any[]).push(
      {
        id: 'clue_1',
        controller: p1,
        owner: p1,
        isToken: true,
        card: { id: 'clue_card_1', name: 'Clue', type_line: 'Token Artifact — Clue', oracle_text: '{2}, Sacrifice this artifact: Draw a card.' },
      },
      {
        id: 'clue_2',
        controller: p1,
        owner: p1,
        isToken: true,
        card: { id: 'clue_card_2', name: 'Clue', type_line: 'Token Artifact — Clue', oracle_text: '{2}, Sacrifice this artifact: Draw a card.' },
      },
      {
        id: 'clue_3',
        controller: p1,
        owner: p1,
        isToken: true,
        card: { id: 'clue_card_3', name: 'Clue', type_line: 'Token Artifact — Clue', oracle_text: '{2}, Sacrifice this artifact: Draw a card.' },
      }
    );

    g.applyEvent({ type: 'sacrificePermanent', permanentId: 'clue_1' } as any);
    g.applyEvent({ type: 'sacrificePermanent', permanentId: 'clue_2' } as any);
    g.applyEvent({ type: 'sacrificePermanent', permanentId: 'clue_3' } as any);

    expect(((g.state as any).sacrificedCluesThisTurn || {})[p1]).toBe(3);

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you sacrificed three or more Clues this turn')).toBe(true);
  });

  it('evaluates "if you put a counter on a creature this turn" from tracked boolean', () => {
    const g = createInitialGameState('t_if_put_counter');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state as any).putCounterOnCreatureThisTurn = { [p1]: false };
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you put a counter on a creature this turn')).toBe(false);

    (g.state as any).putCounterOnCreatureThisTurn = { [p1]: true };
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you put a counter on a creature this turn')).toBe(true);
  });
});
