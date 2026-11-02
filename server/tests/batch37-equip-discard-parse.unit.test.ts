import { describe, it, expect } from 'vitest';
import { parseEquipAbilitiesFromOracle } from '../../shared/src/equipAbilities.js';

describe('batch 37 equip discard parse', () => {
  it('parses Equip\u2014Discard a card', () => {
    const parsed = parseEquipAbilitiesFromOracle('Equipped creature gets +2/+0.\nEquip\u2014Discard a card.');
    expect(parsed.map((p: any) => p.cost)).toContain('Discard a card');
  });
});
