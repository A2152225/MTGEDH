import { describe, it, expect } from 'vitest';
import { applyStaticAbilitiesToBattlefield } from '../src/staticAbilities.js';

describe('applyStaticAbilitiesToBattlefield', () => {
  it('preserves precomputed effective power/toughness values', () => {
    const battlefield = [
      {
        id: 'perm_omnath',
        controller: 'p1',
        owner: 'p1',
        card: {
          name: 'Omnath, Locus of Mana',
          type_line: 'Legendary Creature — Elemental',
          power: '1',
          toughness: '1',
        },
        effectivePower: 4,
        effectiveToughness: 4,
      } as any,
    ];

    const result = applyStaticAbilitiesToBattlefield(battlefield);

    expect(result[0].effectivePower).toBe(4);
    expect(result[0].effectiveToughness).toBe(4);
  });
});
