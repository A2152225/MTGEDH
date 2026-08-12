import { describe, expect, it } from 'vitest';

import {
  canAddModeUnderPBudget,
  isValidPBudgetSelection,
  sumSelectedPCost,
} from '../../shared/src';

describe('ModalSpell {P} budget helpers (client)', () => {
  const modes = [
    { id: 'Mode 1', pCost: 1 },
    { id: 'Mode 2', pCost: 2 },
    { id: 'Mode 3', pCost: 3 },
  ];

  it('allows empty up-to selections', () => {
    expect(isValidPBudgetSelection([], modes, 5, { minModes: 0, canRepeatModes: true })).toBe(true);
  });

  it('tracks spent budget for UI gating', () => {
    const selected = ['Mode 2', 'Mode 1'];
    expect(sumSelectedPCost(selected, modes)).toBe(3);
    expect(canAddModeUnderPBudget(selected, 'Mode 3', modes, 5, true)).toBe(false);
    expect(canAddModeUnderPBudget(selected, 'Mode 1', modes, 5, true)).toBe(true);
  });
});
