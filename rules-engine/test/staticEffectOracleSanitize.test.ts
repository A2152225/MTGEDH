import { describe, expect, it } from 'vitest';
import { sanitizeOracleTextForStaticEffectScan } from '../src/staticEffectOracleSanitize';

describe('staticEffectOracleSanitize', () => {
  it('strips quoted emblem clauses from planeswalker loyalty text', () => {
    const oracle = [
      '+1: Create three 1/1 white Soldier creature tokens.',
      '−3: Destroy all creatures with power 4 or greater.',
      '−7: You get an emblem with "Creatures you control get +2/+2 and have flying."',
    ].join('\n');

    const sanitized = sanitizeOracleTextForStaticEffectScan(oracle).toLowerCase();
    expect(sanitized).not.toContain('creatures you control get +2/+2');
    expect(sanitized).not.toContain('have flying');
    expect(sanitized).toContain('create three 1/1 white soldier creature tokens');
  });
});
