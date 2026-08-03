import { describe, expect, it } from 'vitest';

import { calculateManaProduction } from '../src/socket/util.js';

describe('Gemstone Array mana production', () => {
  const gemstone = {
    id: 'stack_gemstone_1',
    controller: 'player1',
    counters: {},
    card: {
      id: 'gemstone-array-card',
      name: 'Gemstone Array',
      type_line: 'Artifact',
      oracle_text:
        '{2}: Put a charge counter on this artifact.\nRemove a charge counter from this artifact: Add one mana of any color.',
    },
  };

  it('produces no mana when there are no charge counters', () => {
    const production = calculateManaProduction(
      { battlefield: [gemstone] },
      gemstone,
      'player1',
      'W',
    );

    expect(production.totalAmount).toBe(0);
    expect(production.colors).toEqual([]);
  });

  it('produces one mana of the chosen color when a charge counter is present', () => {
    const withCounter = {
      ...gemstone,
      counters: { charge: 1 },
    };
    const production = calculateManaProduction(
      { battlefield: [withCounter] },
      withCounter,
      'player1',
      'U',
    );

    expect(production.totalAmount).toBe(1);
    expect(production.colors).toContain('U');
  });
});
