import { describe, expect, it } from 'vitest';

import { parseSacrificeCost } from '../../shared/src/textUtils.js';

describe('shared text utils', () => {
  it('treats singular "Sacrifice another ..." costs as one required other sacrifice', () => {
    expect(parseSacrificeCost('Sacrifice another artifact')).toMatchObject({
      requiresSacrifice: true,
      sacrificeType: 'artifact',
      sacrificeCount: 1,
      mustBeOther: true,
    });
  });
});