import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe("Intervening-if: 'if it's at least one of the chosen colors' (Item 4)", () => {
  it('returns true when intersection exists (supports name + letter normalization)', () => {
    const ctx: any = { state: {} };
    const src: any = { chosenColors: ['red', 'green'], colors: ['R'] };
    expect(evaluateInterveningIfClause(ctx, 'p1', "if it's at least one of the chosen colors", src, {} as any)).toBe(true);
  });

  it('returns false when colors are known but empty (colorless)', () => {
    const ctx: any = { state: {} };
    const src: any = { chosenColor: 'blue', colors: [] };
    expect(evaluateInterveningIfClause(ctx, 'p1', "if it's at least one of the chosen colors", src, {} as any)).toBe(false);
  });

  it('returns false when intersection does not exist', () => {
    const ctx: any = { state: {} };
    const src: any = { chosenColors: ['blue', 'green'], colors: ['R'] };
    expect(evaluateInterveningIfClause(ctx, 'p1', "if it's at least one of the chosen colors", src, {} as any)).toBe(false);
  });

  it('accepts color_identity as a color source', () => {
    const ctx: any = { state: {} };
    const src: any = { chosenColor: 'blue', card: { color_identity: ['U'] } };
    expect(evaluateInterveningIfClause(ctx, 'p1', "if it's at least one of the chosen colors", src, {} as any)).toBe(true);
  });

  it('returns null when chosen colors are missing', () => {
    const ctx: any = { state: {} };
    const src: any = { colors: ['G'] };
    expect(evaluateInterveningIfClause(ctx, 'p1', "if it's at least one of the chosen colors", src, {} as any)).toBe(null);
  });

  it('returns null when object colors are untracked', () => {
    const ctx: any = { state: {} };
    const src: any = { chosenColor: 'red' };
    expect(evaluateInterveningIfClause(ctx, 'p1', "if it's at least one of the chosen colors", src, {} as any)).toBe(null);
  });
});
