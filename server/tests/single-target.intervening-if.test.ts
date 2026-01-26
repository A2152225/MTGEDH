import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClauseDetailed } from '../src/state/modules/triggers/intervening-if';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

describe('Intervening-if: single target', () => {
  beforeEach(() => {
    ResolutionQueueManager.removeQueue('t_intervening_if_single_target');
  });

  it('can evaluate "if it has a single target" from refs.stackItem.targets', () => {
    const g = createInitialGameState('t_intervening_if_single_target');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const clause = 'if it has a single target';

    const one = evaluateInterveningIfClauseDetailed(g as any, String(p1), clause, undefined, {
      stackItem: { targets: ['perm_a'] },
    } as any);
    expect(one.matched).toBe(true);
    expect(one.value).toBe(true);

    const two = evaluateInterveningIfClauseDetailed(g as any, String(p1), clause, undefined, {
      stackItem: { targets: ['perm_a', 'perm_b'] },
    } as any);
    expect(two.matched).toBe(true);
    expect(two.value).toBe(false);
  });

  it('can evaluate via triggeringStackItemId lookup in ctx.state.stack', () => {
    const g = createInitialGameState('t_intervening_if_single_target');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).stack = [
      { id: 'spell_1', type: 'spell', targets: ['perm_a'] },
      { id: 'spell_2', type: 'spell', targets: ['perm_a', 'perm_b'] },
    ];

    const clause = 'if it has a single target';

    const one = evaluateInterveningIfClauseDetailed(g as any, String(p1), clause, undefined, {
      triggeringStackItemId: 'spell_1',
    } as any);
    expect(one.matched).toBe(true);
    expect(one.value).toBe(true);

    const two = evaluateInterveningIfClauseDetailed(g as any, String(p1), clause, undefined, {
      triggeringStackItemId: 'spell_2',
    } as any);
    expect(two.matched).toBe(true);
    expect(two.value).toBe(false);
  });

  it('stays conservative (null) when there is no target metadata', () => {
    const g = createInitialGameState('t_intervening_if_single_target');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const res = evaluateInterveningIfClauseDetailed(g as any, String(p1), 'if it has a single target');
    expect(res.matched).toBe(true);
    expect(res.value).toBe(null);
  });
});
