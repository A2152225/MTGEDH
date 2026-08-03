import { describe, expect, it } from 'vitest';
import { canPayManaCost, parseManaCost } from '../src/state/modules/mana-check.js';

describe('canPayManaCost large floating pools', () => {
  it('stays fast with thousands of floating mana (Three Tree / Cradle)', () => {
    const pool = {
      white: 0,
      blue: 4703,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    };
    const started = Date.now();
    expect(canPayManaCost(pool, parseManaCost('{3}{U}'))).toBe(true);
    expect(canPayManaCost(pool, parseManaCost('{U}{U}{U}'))).toBe(true);
    expect(canPayManaCost(pool, parseManaCost('{R}'))).toBe(false);
    expect(Date.now() - started).toBeLessThan(50);
  });
});
