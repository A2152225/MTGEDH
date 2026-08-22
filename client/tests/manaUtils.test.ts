import { describe, expect, it } from 'vitest';

import { applyXValueToParsedCost, calculateSuggestedPayment, parseManaCost, paymentToPool } from '../src/utils/manaUtils';

describe('calculateSuggestedPayment', () => {
  it('counts exact produced color bundles in selected payment pools', () => {
    expect(paymentToPool([
      {
        permanentId: 'signet_1',
        mana: 'B',
        count: 2,
        producedColors: ['B', 'R'],
      },
    ])).toEqual({
      W: 0,
      U: 0,
      B: 1,
      R: 1,
      G: 0,
      C: 0,
    });
  });

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

describe('applyXValueToParsedCost', () => {
  it('does not double-count X when the mana cost is already expanded', () => {
    const cost = applyXValueToParsedCost(parseManaCost('{10}{W}{W}'), 10);
    expect(cost.generic).toBe(10);
    expect(cost.colors.W).toBe(2);
  });

  it('expands unexpanded {X} by xCount', () => {
    expect(applyXValueToParsedCost(parseManaCost('{X}{W}{W}'), 10).generic).toBe(10);
    expect(applyXValueToParsedCost(parseManaCost('{X}{X}{G}'), 7).generic).toBe(14);
  });
});

describe('calculateSuggestedPayment colored-before-generic', () => {
  it('reserves white sources for {W}{W} before spending them on X/generic', () => {
    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 2, U: 0, B: 0, R: 0, G: 0, C: 0 },
        generic: 10,
        hybrids: [],
      },
      [
        { id: 'plains_1', name: 'Plains', options: ['W'] },
        { id: 'plains_2', name: 'Plains', options: ['W'] },
        { id: 'plains_3', name: 'Plains', options: ['W'] },
        { id: 'plains_4', name: 'Plains', options: ['W'] },
        { id: 'forest_1', name: 'Forest', options: ['G'] },
        { id: 'forest_2', name: 'Forest', options: ['G'] },
        { id: 'forest_3', name: 'Forest', options: ['G'] },
        { id: 'forest_4', name: 'Forest', options: ['G'] },
        { id: 'forest_5', name: 'Forest', options: ['G'] },
        { id: 'wastes_1', name: 'Wastes', options: ['C'] },
        { id: 'wastes_2', name: 'Wastes', options: ['C'] },
        { id: 'wastes_3', name: 'Wastes', options: ['C'] },
      ],
      new Set(),
    );

    const whiteAssignments = [...suggestion.entries()].filter(([, sel]) => sel.color === 'W');
    expect(whiteAssignments.length).toBeGreaterThanOrEqual(2);
    expect(whiteAssignments.slice(0, 2).every(([, sel]) => sel.count >= 1)).toBe(true);

    const pool = paymentToPool(
      [...suggestion.entries()].map(([id, sel]) => ({ permanentId: id, mana: sel.color, count: sel.count })),
    );
    expect(pool.W).toBeGreaterThanOrEqual(2);
    expect(pool.W + pool.U + pool.B + pool.R + pool.G + pool.C).toBeGreaterThanOrEqual(12);
  });
});
