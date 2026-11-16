import { describe, expect, it } from 'vitest';
import {
  applySpendAsThoughToSources,
  canPayCostWithSpendAsThough,
  getClientManaSpendAsThoughRules,
} from '../src/utils/manaSpendAsThough';

const LATTICE = "Players may spend mana as though it were mana of any color.";
const DAWN = 'You may spend white mana as though it were mana of any color. You may spend other mana only as though it were colorless mana.';

describe('client spend-as-though helpers', () => {
  it('lets PaymentPicker-style auto-pay treat Dawn white sources as any color', () => {
    const rules = getClientManaSpendAsThoughRules([
      { id: 'dawn', controller: 'p1', card: { oracle_text: DAWN } },
    ], 'p1');
    const sources = applySpendAsThoughToSources([
      { id: 'plains', options: ['W'] as const },
      { id: 'island', options: ['U'] as const },
    ] as any, rules);
    expect(sources[0].options).toEqual(expect.arrayContaining(['W', 'U', 'B', 'R', 'G']));
    expect(sources[1].options).toEqual(['C']);
    expect(canPayCostWithSpendAsThough(
      { colors: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 }, generic: 0, hybrids: [] },
      { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 },
      rules,
    )).toBe(true);
  });

  it('lets Lattice sources pay any color', () => {
    const rules = getClientManaSpendAsThoughRules([
      { id: 'lat', controller: 'p2', card: { oracle_text: LATTICE } },
    ], 'p1');
    expect(rules.anyColor).toBe(true);
    expect(canPayCostWithSpendAsThough(
      { colors: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 }, generic: 0, hybrids: [] },
      { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
      rules,
    )).toBe(true);
  });
});
