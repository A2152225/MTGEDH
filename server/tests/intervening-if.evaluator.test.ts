import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { isInterveningIfSatisfied } from '../src/state/modules/triggers/intervening-if';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

describe('Intervening-if evaluator (expanded templates)', () => {
  it('supports comma-delimited upkeep template: "At the beginning of your upkeep, if no opponent has more life than you"', () => {
    const g = createInitialGameState('t_intervening_if_eval_life_no_opp_more');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).life = { [p1]: 10, [p2]: 9 };

    const desc = 'At the beginning of your upkeep, if no opponent has more life than you, abandon this scheme.';
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).life = { [p1]: 10, [p2]: 11 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports comma-delimited upkeep template: "..., if an opponent has more life than you"', () => {
    const g = createInitialGameState('t_intervening_if_eval_life_opp_more');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const desc = 'At the beginning of your upkeep, if an opponent has more life than you, you gain 1 life.';

    (g.state as any).life = { [p1]: 10, [p2]: 11 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).life = { [p1]: 10, [p2]: 10 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports "If it\'s your turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_your_turn');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).turnPlayer = p1;

    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's your turn, draw a card.")).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), "If it's your turn, draw a card.")).toBe(false);
  });

  it('supports "If you control exactly N lands"', () => {
    const g = createInitialGameState('t_intervening_if_eval_exactly');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).battlefield = [
      { id: 'l1', controller: p1, owner: p1, card: { name: 'Plains', type_line: 'Basic Land — Plains' } },
      { id: 'l2', controller: p1, owner: p1, card: { name: 'Island', type_line: 'Basic Land — Island' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control exactly two lands, draw a card.')).toBe(true);

    (g.state as any).battlefield.push({
      id: 'l3',
      controller: p1,
      owner: p1,
      card: { name: 'Swamp', type_line: 'Basic Land — Swamp' },
    });

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control exactly two lands, draw a card.')).toBe(false);
  });

  it('supports "If you control a/an <type>" existence checks', () => {
    const g = createInitialGameState('t_intervening_if_eval_exists');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).battlefield = [];
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control an artifact, draw a card.')).toBe(false);

    (g.state as any).battlefield.push({
      id: 'a1',
      controller: p1,
      owner: p1,
      card: { name: 'Sol Ring', type_line: 'Artifact' },
    });

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control an artifact, draw a card.')).toBe(true);
  });

  it('supports "..., if N or more spells were cast this turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_spells_cast_this_turn');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const desc = "At the beginning of each end step, if four or more spells were cast this turn, abandon this scheme.";

    (g.state as any).spellsCastThisTurn = ['s1', 's2', 's3', 's4'];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).spellsCastThisTurn = ['s1', 's2', 's3'];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports "If you attacked with N or more creatures this turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_attacked_with_n');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const desc = 'If you attacked with three or more creatures this turn, draw a card.';

    (g.state as any).creaturesAttackedThisTurn = { [p1]: 3, [p2]: 0 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), desc)).toBe(false);

    (g.state as any).creaturesAttackedThisTurn = { [p1]: 2 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports Renown template: "..., if it isn\'t renowned" (requires source permanent)', () => {
    const g = createInitialGameState('t_intervening_if_eval_renown');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = "When this creature deals combat damage to a player, if it isn't renowned, put a +1/+1 counter on it and it becomes renowned.";

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { renowned: false })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { renowned: true })).toBe(false);

    // Without a source permanent, this clause is intentionally treated as unknown.
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);
  });
});
