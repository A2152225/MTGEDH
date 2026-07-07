import { describe, expect, it } from 'vitest';

import { isSpellWorthCastingAtX } from '../src/state/modules/spellXCastUtils.js';

describe('spellXCastUtils', () => {
  it('rejects Pest Infestation at X=0', () => {
    const oracle = 'Destroy up to X target artifacts and/or enchantments. Create twice X 1/1 black and green Pest creature tokens with "When this token dies, you gain 1 life."';
    expect(isSpellWorthCastingAtX(oracle, 0)).toBe(false);
    expect(isSpellWorthCastingAtX(oracle, 1)).toBe(true);
  });

  it('still allows mandatory-target spells at X=0', () => {
    const oracle = 'Destroy target creature. Investigate X times.';
    expect(isSpellWorthCastingAtX(oracle, 0)).toBe(true);
  });

  it('rejects draw-X-only spells at X=0', () => {
    expect(isSpellWorthCastingAtX('Draw X cards.', 0)).toBe(false);
  });
});
