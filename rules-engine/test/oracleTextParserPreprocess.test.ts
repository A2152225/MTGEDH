import { describe, expect, it } from 'vitest';

import { normalizeOracleTextSelfReferences } from '../src/oracleTextParserPreprocess.js';

describe('normalizeOracleTextSelfReferences', () => {
  it('does not replace token type names inside create-token clauses', () => {
    const text =
      'Create X 1/1 white Human Soldier creature tokens, where X is the number of Humans you control.';
    expect(normalizeOracleTextSelfReferences(text, 'Human Soldier')).toContain('Human Soldier creature tokens');
    expect(normalizeOracleTextSelfReferences(text, 'Human Soldier')).not.toContain('this permanent creature tokens');
  });
});
