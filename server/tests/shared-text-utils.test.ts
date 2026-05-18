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

  it('parses artifact-or-creature and nonland permanent sacrifice costs', () => {
    expect(parseSacrificeCost('As an additional cost to cast this spell, sacrifice an artifact or creature.')).toMatchObject({
      requiresSacrifice: true,
      sacrificeType: 'artifact_or_creature',
      sacrificeCount: 1,
    });

    expect(parseSacrificeCost('As an additional cost to cast this spell, sacrifice a nonland permanent.')).toMatchObject({
      requiresSacrifice: true,
      sacrificeType: 'nonland_permanent',
      sacrificeCount: 1,
    });
  });
});