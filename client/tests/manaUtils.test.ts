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

  it('prefers reusable sources over consumable mana sources when both can pay the same color', () => {
    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
        generic: 0,
        hybrids: [],
      },
      [
        { id: 'petal_1', name: 'Lotus Petal', options: ['R'], consumable: true },
        { id: 'mountain_1', name: 'Mountain', options: ['R'] },
      ],
      new Set(),
    );

    expect(suggestion.size).toBe(1);
    expect(suggestion.get('mountain_1')).toEqual({ color: 'R', count: 1 });
    expect(suggestion.has('petal_1')).toBe(false);
  });

  it('falls back to consumable sources when reusable mana is not enough', () => {
    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        generic: 2,
        hybrids: [],
      },
      [
        { id: 'forest_1', name: 'Forest', options: ['G'] },
        { id: 'treasure_1', name: 'Treasure', options: ['W', 'U', 'B', 'R', 'G'], consumable: true },
      ],
      new Set(),
    );

    expect(suggestion.size).toBe(2);
    expect(suggestion.get('forest_1')).toEqual({ color: 'G', count: 1 });
    expect(suggestion.get('treasure_1')).toEqual({ color: 'W', count: 1 });
  });
});