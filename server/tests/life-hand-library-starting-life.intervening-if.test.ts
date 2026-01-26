import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name } as any);
}

describe('Intervening-if: life/hand/library/starting-life batch', () => {
  it('evaluates life lost this turn (did not / N or more)', () => {
    const g = createInitialGameState('t_if_life_lost');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).lifeLostThisTurn = { [p1]: 0 };
    expect(evaluateInterveningIfClause(g as any, String(p1), "if you didn't lose life this turn")).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you lost three or more life this turn')).toBe(false);

    (g.state as any).lifeLostThisTurn = { [p1]: 3 };
    expect(evaluateInterveningIfClause(g as any, String(p1), "if you didn't lose life this turn")).toBe(false);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you lost three or more life this turn')).toBe(true);
  });

  it('evaluates "each player has 10 or less life" conservatively', () => {
    const g = createInitialGameState('t_if_each_player_life');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).life = { [p1]: 10, [p2]: 9 };
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if each player has 10 or less life')).toBe(true);

    (g.state as any).life = { [p1]: 10, [p2]: 11 };
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if each player has 10 or less life')).toBe(false);

    // Player life is always known for joined players (defaults apply), so missing map entries can still be decidable.
    (g.state as any).life = { [p1]: 10 };
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if each player has 10 or less life')).toBe(false);
  });

  it('evaluates "each player has an empty library" conservatively', () => {
    const g = createInitialGameState('t_if_each_player_library');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).zones[p1].libraryCount = 0;
    (g.state as any).zones[p2].libraryCount = 0;
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if each player has an empty library')).toBe(true);

    (g.state as any).zones[p2].libraryCount = 1;
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if each player has an empty library')).toBe(false);

    delete (g.state as any).zones[p2].libraryCount;
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if each player has an empty library')).toBe(null);
  });

  it('evaluates hand-size templates (card in hand / exactly thirteen)', () => {
    const g = createInitialGameState('t_if_hand');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones[p1].handCount = 0;
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you have a card in hand')).toBe(false);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you have exactly thirteen cards in your hand')).toBe(false);

    (g.state as any).zones[p1].handCount = 1;
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you have a card in hand')).toBe(true);

    (g.state as any).zones[p1].handCount = 13;
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if you have exactly thirteen cards in your hand')).toBe(true);
  });

  it('evaluates land-play tracking (did not play a land this turn)', () => {
    const g = createInitialGameState('t_if_land_play');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).landsPlayedThisTurn = { [p1]: 0 };
    expect(evaluateInterveningIfClause(g as any, String(p1), "if you didn't play a land this turn")).toBe(true);

    (g.state as any).landsPlayedThisTurn = { [p1]: 1 };
    expect(evaluateInterveningIfClause(g as any, String(p1), "if you didn't play a land this turn")).toBe(false);

    delete (g.state as any).landsPlayedThisTurn;
    expect(evaluateInterveningIfClause(g as any, String(p1), "if you didn't play a land this turn")).toBe(null);
  });

  it('evaluates starting-life comparisons', () => {
    const g = createInitialGameState('t_if_starting_life');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).startingLife = 20;
    (g.state as any).life = { [p1]: 34 };
    expect(
      evaluateInterveningIfClause(g as any, String(p1), 'if you have at least 15 life more than your starting life total')
    ).toBe(false);

    (g.state as any).life = { [p1]: 35 };
    expect(
      evaluateInterveningIfClause(g as any, String(p1), 'if you have at least 15 life more than your starting life total')
    ).toBe(true);

    (g.state as any).life = { [p1]: 21 };
    expect(
      evaluateInterveningIfClause(g as any, String(p1), 'if your life total is greater than your starting life total')
    ).toBe(true);
    expect(
      evaluateInterveningIfClause(g as any, String(p1), 'if your life total is less than your starting life total')
    ).toBe(false);

    (g.state as any).life = { [p1]: 6 };
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if your life total is less than 7')).toBe(true);
    (g.state as any).life = { [p1]: 7 };
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if your life total is less than 7')).toBe(false);
  });
});
