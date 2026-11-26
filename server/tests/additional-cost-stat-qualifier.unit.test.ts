import { describe, expect, it } from 'vitest';

import { permanentMatchesAdditionalCostTypeFilter, typeLineMatchesAdditionalCostFilter } from '../src/socket/additionalCostTypeFilter.js';

const creature = (power: string, toughness: string, cmc: number) => ({
  card: { type_line: 'Creature \u2014 Beast', power, toughness, cmc },
});

describe('additional-cost filter stat qualifiers (Savage Order)', () => {
  it('checks "with power 4 or greater" against the permanent', () => {
    expect(permanentMatchesAdditionalCostTypeFilter(creature('4', '4', 5), 'creature with power 4 or greater')).toBe(true);
    expect(permanentMatchesAdditionalCostTypeFilter(creature('2', '2', 2), 'creature with power 4 or greater')).toBe(false);
    expect(permanentMatchesAdditionalCostTypeFilter({ ...creature('2', '2', 2), effectivePower: 5 }, 'creature with power 4 or greater')).toBe(true);
  });

  it('supports toughness / mana value, "or less" and exact values', () => {
    expect(permanentMatchesAdditionalCostTypeFilter(creature('1', '1', 1), 'creature with toughness 2 or less')).toBe(true);
    expect(permanentMatchesAdditionalCostTypeFilter(creature('1', '3', 1), 'creature with toughness 2 or less')).toBe(false);
    expect(permanentMatchesAdditionalCostTypeFilter(creature('1', '1', 3), 'creature with mana value 3')).toBe(true);
    expect(permanentMatchesAdditionalCostTypeFilter(creature('1', '1', 2), 'creature with mana value 3')).toBe(false);
  });

  it('keeps the type part working on its own', () => {
    expect(typeLineMatchesAdditionalCostFilter('Artifact', 'creature with power 4 or greater')).toBe(false);
    expect(typeLineMatchesAdditionalCostFilter('Creature \u2014 Beast', 'creature with power 4 or greater')).toBe(true);
    expect(permanentMatchesAdditionalCostTypeFilter({ card: { type_line: 'Artifact' } }, 'artifact or creature')).toBe(true);
  });
});
