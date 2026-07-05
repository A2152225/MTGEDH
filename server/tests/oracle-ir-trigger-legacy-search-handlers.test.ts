import { describe, expect, it } from 'vitest';

import { parseTriggerEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';

describe('oracle IR trigger legacy search handlers', () => {
  it('parses Protean Hulk search as any_number search_library with total MV cap', () => {
    const steps = parseTriggerEffectSteps(
      'search your library for any number of creature cards with total mana value 6 or less and put them onto the battlefield. Then shuffle.',
      'Protean Hulk',
    );
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      kind: 'search_library',
      destination: 'battlefield',
      maxResults: 'any_number',
      criteria: { kind: 'raw', text: 'creature with total mana value 6 or less' },
    });
    expect(steps[1]?.kind).toBe('shuffle_library');
  });
});
