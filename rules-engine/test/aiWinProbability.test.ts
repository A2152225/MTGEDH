/**
 * P1-2 winProbabilities unit tests.
 */

import { describe, expect, it } from 'vitest';
import { winProbabilities } from '../src/ai/winProbability.js';

describe('winProbabilities', () => {
  it('sums to 1 for 2, 3, and 4 live seats', () => {
    for (const n of [2, 3, 4]) {
      const values: Record<string, number> = {};
      for (let i = 0; i < n; i++) values[`p${i}`] = i;
      const probs = winProbabilities(values, []);
      const sum = Object.values(probs).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  it('equal values give equal shares', () => {
    const probs = winProbabilities({ a: 1, b: 1, c: 1, d: 1 }, []);
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(probs[id]).toBeCloseTo(0.25, 10);
    }
  });

  it('raising one value never lowers that seat share', () => {
    const base = winProbabilities({ a: 1, b: 1, c: 1 }, []);
    const raised = winProbabilities({ a: 5, b: 1, c: 1 }, []);
    expect(raised.a).toBeGreaterThan(base.a);
    expect(raised.b).toBeLessThan(base.b);
  });

  it('a 500-point gap stays finite with no NaN', () => {
    const probs = winProbabilities({ a: 500, b: 0, c: 0, d: 0 }, []);
    for (const v of Object.values(probs)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Number.isNaN(v)).toBe(false);
    }
    expect(probs.a).toBeGreaterThan(0.99);
    expect(Object.values(probs).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('eliminated seats get 0 and the rest still sum to 1', () => {
    const probs = winProbabilities({ a: 2, b: 2, c: 2, d: 2 }, ['c', 'd']);
    expect(probs.c).toBe(0);
    expect(probs.d).toBe(0);
    expect(probs.a + probs.b).toBeCloseTo(1, 10);
    expect(probs.a).toBeCloseTo(0.5, 10);
  });

  it('all seats eliminated returns all zeros', () => {
    const probs = winProbabilities({ a: 1, b: 1 }, ['a', 'b']);
    expect(probs).toEqual({ a: 0, b: 0 });
  });

  it('tau of 0 throws', () => {
    expect(() => winProbabilities({ a: 1 }, [], 0)).toThrow(RangeError);
  });
});
