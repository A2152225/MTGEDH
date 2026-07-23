import { describe, expect, it } from 'vitest';

import { hasTrainingKeyword } from '../src/keywordAbilities/training.js';

describe('hasTrainingKeyword', () => {
  it('detects Training on printed cards', () => {
    expect(
      hasTrainingKeyword({
        oracle_text:
          'Training\nWhenever this creature attacks with another creature with greater power, put a +1/+1 counter on this creature.',
      }),
    ).toBe(true);
    expect(hasTrainingKeyword({ keywords: ['Training'] })).toBe(true);
  });

  it('ignores unrelated oracle text containing "training"', () => {
    expect(
      hasTrainingKeyword({
        name: 'Training Grounds',
        oracle_text: 'Activated abilities of creatures you control cost {1} less to activate.',
      }),
    ).toBe(false);
    expect(hasTrainingKeyword({ oracle_text: '' })).toBe(false);
  });
});
