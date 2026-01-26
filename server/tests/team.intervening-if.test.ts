import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClauseDetailed } from '../src/state/modules/triggers/intervening-if';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

describe('Intervening-if: team clauses', () => {
  beforeEach(() => {
    ResolutionQueueManager.removeQueue('t_intervening_if_team');
  });

  it("evaluates 'if your team controls another Warrior' using team membership", () => {
    const g = createInitialGameState('t_intervening_if_team');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');

    (g.state as any).team = { [p1]: 'A', [p2]: 'A', [p3]: 'B' };

    // Source permanent (non-warrior) controlled by p1.
    const source = {
      id: 'src_1',
      controller: p1,
      owner: p1,
      card: { id: 'src_card', name: 'Source', type_line: 'Enchantment' },
    };

    (g.state as any).battlefield.push(source);

    // Teammate controls a Warrior -> true
    (g.state as any).battlefield.push({
      id: 'w_1',
      controller: p2,
      owner: p2,
      card: { id: 'w_card', name: 'Warrior Guy', type_line: 'Creature  Human Warrior' },
    });

    const res = evaluateInterveningIfClauseDetailed(g as any, String(p1), 'if your team controls another Warrior', source);
    expect(res.matched).toBe(true);
    expect(res.value).toBe(true);

    // Remove the warrior -> false
    (g.state as any).battlefield = (g.state as any).battlefield.filter((p: any) => p.id !== 'w_1');
    const res2 = evaluateInterveningIfClauseDetailed(g as any, String(p1), 'if your team controls another Warrior', source);
    expect(res2.matched).toBe(true);
    expect(res2.value).toBe(false);
  });

  it("falls back to singleton team when no team data exists", () => {
    const g = createInitialGameState('t_intervening_if_team');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const source = {
      id: 'src_2',
      controller: p1,
      owner: p1,
      card: { id: 'src_card_2', name: 'Source', type_line: 'Enchantment' },
    };

    (g.state as any).battlefield.push(source);

    // Another Warrior you control -> true
    (g.state as any).battlefield.push({
      id: 'w_2',
      controller: p1,
      owner: p1,
      card: { id: 'w_card_2', name: 'Warrior Two', type_line: 'Creature  Warrior' },
    });

    const res = evaluateInterveningIfClauseDetailed(g as any, String(p1), 'if your team controls another Warrior', source);
    expect(res.matched).toBe(true);
    expect(res.value).toBe(true);
  });

  it("evaluates 'if you're on the Mirran team' from state.team mapping", () => {
    const g = createInitialGameState('t_intervening_if_team');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).team = { [p1]: 'Mirran', [p2]: 'Phyrexian' };

    const mirran = evaluateInterveningIfClauseDetailed(g as any, String(p1), "if you're on the Mirran team");
    expect(mirran.matched).toBe(true);
    expect(mirran.value).toBe(true);

    const phyrexian = evaluateInterveningIfClauseDetailed(g as any, String(p2), "if you're on the Mirran team");
    expect(phyrexian.matched).toBe(true);
    expect(phyrexian.value).toBe(false);
  });

  it("evaluates 'if your team gained life this turn'", () => {
    const g = createInitialGameState('t_intervening_if_team');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).team = { [p1]: 'A', [p2]: 'A' };
    (g.state as any).lifeGainedThisTurn = { [p1]: 0, [p2]: 1 };

    const res = evaluateInterveningIfClauseDetailed(g as any, String(p1), 'if your team gained life this turn');
    expect(res.matched).toBe(true);
    expect(res.value).toBe(true);

    // All numeric but zeros -> false
    (g.state as any).lifeGainedThisTurn = { [p1]: 0, [p2]: 0 };
    const res2 = evaluateInterveningIfClauseDetailed(g as any, String(p1), 'if your team gained life this turn');
    expect(res2.matched).toBe(true);
    expect(res2.value).toBe(false);
  });
});
