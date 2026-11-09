import { afterEach, describe, expect, it } from 'vitest';
import { aiRandom, getAIRandomSeed, seedAIRandom } from '../src/aiRandom';

describe('aiRandom (P0-3)', () => {
  afterEach(() => {
    seedAIRandom(null);
  });

  it('defaults to Math.random when unseeded', () => {
    seedAIRandom(null);
    expect(getAIRandomSeed()).toBeNull();
    const sample = aiRandom();
    expect(sample).toBeGreaterThanOrEqual(0);
    expect(sample).toBeLessThan(1);
  });

  it('is deterministic for the same seed', () => {
    seedAIRandom(42);
    const a = [aiRandom(), aiRandom(), aiRandom(), aiRandom()];
    seedAIRandom(42);
    const b = [aiRandom(), aiRandom(), aiRandom(), aiRandom()];
    expect(a).toEqual(b);
    expect(getAIRandomSeed()).toBe(42);
  });

  it('diverges across different seeds', () => {
    seedAIRandom(1);
    const a = aiRandom();
    seedAIRandom(2);
    const b = aiRandom();
    expect(a).not.toBe(b);
  });
});
