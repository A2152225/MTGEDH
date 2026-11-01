import { describe, it, expect } from 'vitest';
import { resolveMultipliedTokenCount, MAX_TOKENS_PER_CREATION_EVENT } from '../src/tokenCreation';

const doubler = (controller: string) => ({
  controller,
  card: { oracle_text: 'If one or more tokens would be created under your control, twice that many of those tokens are created instead.', type_line: 'Enchantment' },
});

describe('token creation cap (2^10)', () => {
  it('is 1024', () => {
    expect(MAX_TOKENS_PER_CREATION_EVENT).toBe(1024);
  });
  it('caps 2^N doublers at 1024', () => {
    const bf = Array.from({ length: 40 }, () => doubler('p1'));
    expect(resolveMultipliedTokenCount('p1', bf, 1).count).toBe(1024);
    const ten = Array.from({ length: 10 }, () => doubler('p1'));
    expect(resolveMultipliedTokenCount('p1', ten, 1).count).toBe(1024);
    expect(resolveMultipliedTokenCount('p1', ten, 3).count).toBe(1024);
  });
  it('leaves normal counts unchanged', () => {
    expect(resolveMultipliedTokenCount('p1', [doubler('p1')], 3).count).toBe(6);
    expect(resolveMultipliedTokenCount('p1', Array.from({ length: 9 }, () => doubler('p1')), 1).count).toBe(512);
    expect(resolveMultipliedTokenCount('p1', [doubler('p2')], 3).count).toBe(3);
    expect(resolveMultipliedTokenCount('p1', [], 2).count).toBe(2);
  });
});