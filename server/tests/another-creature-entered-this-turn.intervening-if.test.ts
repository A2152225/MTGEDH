import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClauseDetailed } from '../src/state/modules/triggers/intervening-if';
import { triggerETBEffectsForPermanent } from '../src/state/modules/stack';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

describe('Intervening-if: another creature entered under your control this turn', () => {
  beforeEach(() => {
    ResolutionQueueManager.removeQueue('t_intervening_if_another_creature');
  });

  it('excludes the source creature deterministically using per-turn id tracking', () => {
    const g = createInitialGameState('t_intervening_if_another_creature');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const clause = 'if another creature entered the battlefield under your control this turn';

    // Put the source creature onto the battlefield and run ETB tracking.
    const source: any = {
      id: 'c_1',
      controller: p1,
      owner: p1,
      tapped: false,
      card: {
        id: 'c_card_1',
        name: 'Source Creature',
        type_line: 'Creature — Test',
      },
    };
    (g.state as any).battlefield.push(source);
    triggerETBEffectsForPermanent(g as any, source, p1);

    // Only the source has entered this turn, so "another creature" should be false.
    const r0 = evaluateInterveningIfClauseDetailed(g as any, String(p1), clause, source);
    expect(r0.matched).toBe(true);
    expect(r0.value).toBe(false);

    // A second creature enters.
    const other: any = {
      id: 'c_2',
      controller: p1,
      owner: p1,
      tapped: false,
      card: {
        id: 'c_card_2',
        name: 'Other Creature',
        type_line: 'Creature — Test',
      },
    };
    (g.state as any).battlefield.push(other);
    triggerETBEffectsForPermanent(g as any, other, p1);

    // Now the source has seen another creature enter this turn.
    const r1 = evaluateInterveningIfClauseDetailed(g as any, String(p1), clause, source);
    expect(r1.matched).toBe(true);
    expect(r1.value).toBe(true);

    // Next turn resets tracking: deterministically false again.
    g.applyEvent({ type: 'nextTurn' });
    const r2 = evaluateInterveningIfClauseDetailed(g as any, String(p1), clause, source);
    expect(r2.matched).toBe(true);
    expect(r2.value).toBe(false);
  });
});
