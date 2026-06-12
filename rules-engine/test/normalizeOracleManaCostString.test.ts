import { describe, expect, it } from 'vitest';
import { normalizeOracleManaCostString } from '../src/oracleIRExecutorManaUtils.js';

describe('normalizeOracleManaCostString', () => {
  it('uppercases colored mana symbols', () => {
    expect(normalizeOracleManaCostString('{u}')).toBe('{U}');
    expect(normalizeOracleManaCostString('{2}{u}{u}')).toBe('{2}{U}{U}');
  });

  it('preserves already-canonical costs', () => {
    expect(normalizeOracleManaCostString('{1}')).toBe('{1}');
    expect(normalizeOracleManaCostString('{U/R}')).toBe('{U/R}');
  });
});
