import { describe, expect, it } from 'vitest';

import { calculateSuggestedPayment } from '../src/utils/manaUtils';

describe('calculateSuggestedPayment', () => {
  it('uses boosted source amounts to assign exact payment counts', () => {
    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        generic: 2,
        hybrids: [],
      },
      [
        { id: 'forest_1', name: 'Forest', options: ['G'], amount: 2 },
        { id: 'forest_2', name: 'Forest', options: ['G'], amount: 2 },
      ],
      new Set(),
    );

    expect(suggestion.size).toBe(2);
    expect(suggestion.get('forest_1')).toEqual({ color: 'G', count: 2 });
    expect(suggestion.get('forest_2')).toEqual({ color: 'G', count: 1 });
  });
});