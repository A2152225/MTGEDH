import { describe, expect, it } from 'vitest';

import {
  canAddModeUnderPBudget,
  choosePBudgetModeSelections,
  isValidPBudgetSelection,
  sumSelectedPCost,
} from '../../shared/src/modeSelectionPBudget.js';

const seasonModes = [
  { id: 'Mode 1', pCost: 1 },
  { id: 'Mode 2', pCost: 2 },
  { id: 'Mode 3', pCost: 3 },
];

describe('modeSelectionPBudget', () => {
  it('sums selected {P} costs with repeats', () => {
    expect(sumSelectedPCost(['Mode 1', 'Mode 1', 'Mode 2'], seasonModes)).toBe(4);
  });

  it('blocks additions that exceed the budget', () => {
    expect(canAddModeUnderPBudget(['Mode 3'], 'Mode 3', seasonModes, 5, true)).toBe(false);
    expect(canAddModeUnderPBudget(['Mode 3'], 'Mode 2', seasonModes, 5, true)).toBe(true);
  });

  it('validates Season-style selections', () => {
    expect(
      isValidPBudgetSelection(['Mode 1', 'Mode 1', 'Mode 3'], seasonModes, 5, {
        minModes: 0,
        canRepeatModes: true,
      }),
    ).toBe(true);
    expect(
      isValidPBudgetSelection(['Mode 3', 'Mode 3'], seasonModes, 5, {
        minModes: 0,
        canRepeatModes: true,
      }),
    ).toBe(false);
    expect(
      isValidPBudgetSelection(['Mode 1', 'Mode 1'], seasonModes, 5, {
        minModes: 0,
        canRepeatModes: false,
      }),
    ).toBe(false);
  });

  it('greedily fills AI selections within budget', () => {
    const scored = [
      { id: 'Mode 1', pCost: 1, score: 1 },
      { id: 'Mode 2', pCost: 2, score: 5 },
      { id: 'Mode 3', pCost: 3, score: 4 },
    ];
    const selected = choosePBudgetModeSelections(scored, 5, { canRepeatModes: true, minModes: 0 });
    expect(sumSelectedPCost(selected, seasonModes)).toBeLessThanOrEqual(5);
    expect(selected[0]).toBe('Mode 2');
  });
});
