import { describe, expect, it } from 'vitest';
import { applyConvokeToCost } from './convokeCostReduction';

const cost = (W: number, generic: number, hybrids: any[] = []) => ({ colors: { W, U: 0, B: 0, R: 0, G: 0, C: 0 } as any, generic, hybrids });

describe('applyConvokeToCost (issue #55)', () => {
  it('21 white Soldiers fully pay {19}{W}{W} (X=20 under Pearl Medallion)', () => {
    const soldiers = Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, colors: ['W'] }));
    const out = applyConvokeToCost(cost(2, 19), soldiers);
    expect(out.colors.W).toBe(0);
    expect(out.generic).toBe(0);
    expect(out.convokeUnused).toBe(0);
  });
  it('colorless creatures pay generic only; extras are reported unused', () => {
    const out = applyConvokeToCost(cost(2, 1), [{ id: 'a' }, { id: 'b' }]);
    expect(out.colors.W).toBe(2);
    expect(out.generic).toBe(0);
    expect(out.convokeUnused).toBe(1);
  });
});
