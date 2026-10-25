import { describe, it, expect } from 'vitest';
import { getCaseSolveEndStepTriggers, tryResolveCaseSolveTrigger } from '../src/state/modules/caseSolve';

const perm = (id: string, controller: string, type_line: string, oracle_text = '', extra: any = {}) =>
  ({ id, controller, owner: controller, counters: {}, ...extra, card: { id, name: id, type_line, oracle_text } }) as any;
const oracle = 'To solve \u2014 Three or more creatures attacked this turn. (If unsolved, solve at the beginning of your end step.)\nSolved \u2014 Creatures you control get +1/+0.';
const atk = (id: string) => perm(id, 'p1', 'Creature \u2014 Bear', '', { attackedThisTurn: true });

describe('Case solve as an end-step trigger (CR 719.3c)', () => {
  it('only triggers when unsolved, controlled by the active player, and the requirement is met', () => {
    const c = perm('case', 'p1', 'Enchantment \u2014 Case', oracle);
    const state: any = { turnPlayer: 'p1', battlefield: [c, atk('a'), atk('b')] };
    expect(getCaseSolveEndStepTriggers({ state }, 'p1')).toHaveLength(0);
    state.battlefield.push(atk('d'));
    expect(getCaseSolveEndStepTriggers({ state }, 'p2')).toHaveLength(0);
    const [t] = getCaseSolveEndStepTriggers({ state }, 'p1');
    expect(t.stackItem).toEqual({ caseSolve: true, caseSolvePermanentId: 'case' });
    expect(c.solved).toBeUndefined();
  });
  it('resolution solves the Case, rechecking the intervening-if', () => {
    const c = perm('case', 'p1', 'Enchantment \u2014 Case', oracle);
    const state: any = { turnPlayer: 'p1', battlefield: [c, atk('a'), atk('b'), atk('d')] };
    const item = { type: 'triggered_ability', caseSolve: true, caseSolvePermanentId: 'case' };
    state.battlefield.pop();
    expect(tryResolveCaseSolveTrigger({ state }, item)).toBe(true);
    expect(c.solved).toBeUndefined();
    state.battlefield.push(atk('d'));
    expect(tryResolveCaseSolveTrigger({ state }, item)).toBe(true);
    expect(c.solved).toBe(true);
    expect(tryResolveCaseSolveTrigger({ state }, { type: 'triggered_ability' })).toBe(false);
  });
});
