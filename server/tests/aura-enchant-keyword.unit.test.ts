import { describe, expect, it } from 'vitest';

import { findEnchantKeywordClause, isAuraSpell } from '../src/socket/auraEnchantKeyword.js';

describe('aura Enchant keyword detection', () => {
  it('finds Enchant after Flash or Kicker', () => {
    const flash = 'Flash\nEnchant creature\nEnchanted creature gets +1/+1.';
    expect(isAuraSpell('Enchantment ? Aura', flash)).toBe(true);
    expect(findEnchantKeywordClause(flash)?.toLowerCase()).toMatch(/^enchant creature/);

    const kicker = 'Kicker {2} (You may pay an additional {2} as you cast this spell.)\nEnchant creature\nEnchanted creature gets +0/+2.';
    expect(isAuraSpell('Enchantment - Aura', kicker)).toBe(true);
  });

  it('still detects a leading Enchant player curse', () => {
    expect(isAuraSpell('Enchantment ? Aura ? Curse', 'Enchant player\nAt the beginning of enchanted player\'s upkeep, that player creates a Treasure token.')).toBe(true);
    expect(findEnchantKeywordClause('Enchant player\nAt the beginning of enchanted player\'s upkeep, create a Treasure.')).toMatch(/^Enchant player/i);
  });

  it('does not treat non-Auras or body text "enchanted" as the keyword', () => {
    expect(isAuraSpell('Enchantment', 'Enchanted creatures you control get +1/+1.')).toBe(false);
    expect(isAuraSpell('Enchantment ? Aura', 'Enchanted creature gets +1/+1.')).toBe(false);
  });
});
