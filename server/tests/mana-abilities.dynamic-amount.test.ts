import { describe, expect, it } from 'vitest';

import { getCreatureCountManaAmount } from '../src/state/modules/mana-abilities.js';

describe('dynamic mana ability helpers', () => {
  it('uses boosted creature power for Bighorner Rancher mana', () => {
    const state: any = {
      battlefield: [
        {
          id: 'rancher',
          controller: 'p1',
          card: {
            name: 'Bighorner Rancher',
            type_line: 'Creature — Ox Mount',
            oracle_text: '{T}: Add an amount of {G} equal to the greatest power among creatures you control.',
          },
        },
        {
          id: 'hydra',
          controller: 'p1',
          basePower: 4,
          counters: { plusOne: 6 },
          modifiers: [{ type: 'powerToughness', power: 6, toughness: 6 }],
          card: {
            name: 'Mossborn Hydra',
            type_line: 'Creature — Hydra',
            power: '4',
            toughness: '4',
            oracle_text: '',
          },
        },
      ],
    };

    expect(getCreatureCountManaAmount(state, state.battlefield[0], 'p1')).toEqual({
      color: 'G',
      amount: 16,
    });
  });

  it('uses boosted creature power for Selvala mana', () => {
    const state: any = {
      battlefield: [
        {
          id: 'selvala',
          controller: 'p1',
          card: {
            name: 'Selvala, Heart of the Wilds',
            type_line: 'Legendary Creature — Elf Scout',
            oracle_text: '{G}, {T}: Add X mana in any combination of colors, where X is the greatest power among creatures you control.',
          },
        },
        {
          id: 'hydra',
          controller: 'p1',
          basePower: 4,
          counters: { plusOne: 6 },
          modifiers: [{ type: 'POWER_TOUGHNESS', power: 6, toughness: 6 }],
          card: {
            name: 'Mossborn Hydra',
            type_line: 'Creature — Hydra',
            power: '4',
            toughness: '4',
            oracle_text: '',
          },
        },
      ],
    };

    expect(getCreatureCountManaAmount(state, state.battlefield[0], 'p1')).toEqual({
      color: 'any_combination',
      amount: 16,
    });
  });
});