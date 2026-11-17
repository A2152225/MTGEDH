import { describe, expect, it } from 'vitest';
import { arabianNightsOriginalNameLockReason, batch112CastRestriction } from '../src/state/modules/batch112Apply.js';

const city = {
  id: 'city',
  controller: 'p1',
  card: {
    name: 'City in a Bottle',
    oracle_text: "Players can't cast spells or play lands with a name originally printed in the Arabian Nights expansion.",
  },
};

describe('Arabian Nights original-name lock', () => {
  it('locks a reprint of an Arabian Nights card and allows an Arabian Nights printing of a later-original basic', () => {
    const state = { battlefield: [city] };
    const library = { name: 'Library of Alexandria', type_line: 'Land', set: '2xm' };
    const mountain = { name: 'Mountain', type_line: 'Basic Land — Mountain', set: 'arn' };

    expect(batch112CastRestriction(state, 'p2', library)).toMatch(/Arabian Nights/i);
    expect(batch112CastRestriction(state, 'p2', mountain)).toBeNull();
    expect(arabianNightsOriginalNameLockReason(state, library)).toMatch(/Arabian Nights/i);
    expect(arabianNightsOriginalNameLockReason(state, mountain)).toBeNull();
    expect(arabianNightsOriginalNameLockReason({ battlefield: [] }, library)).toBeNull();
  });
});
