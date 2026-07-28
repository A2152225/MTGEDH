import { describe, expect, it } from 'vitest';

import { getCreatureCountManaAmount } from '../src/state/modules/mana-abilities.js';
import {
  buildManaProductionColorSelectionFields,
  buildAnyCombinationManaSelectionFields,
  resolveAllowedColorsForCombinationMana,
} from '../src/state/modules/manaColorSelectionStepUtils.js';

const THREE_TREE_ORACLE =
  'As Three Tree City enters, choose a creature type.\n{T}: Add {C}.\n{2}, {T}: Choose a color. Add an amount of mana of that color equal to the number of creatures you control of the chosen type.';

describe('Three Tree City mana production', () => {
  it('reports any_one_color with creature-type count (not any_combination)', () => {
    const city: any = {
      id: 'city_1',
      controller: 'p1',
      chosenCreatureType: 'Elf',
      card: {
        name: 'Three Tree City',
        type_line: 'Legendary Land',
        oracle_text: THREE_TREE_ORACLE,
      },
    };
    const state: any = {
      battlefield: [
        city,
        {
          id: 'elf_1',
          controller: 'p1',
          card: { name: 'Llanowar Elves', type_line: 'Creature — Elf Druid' },
        },
        {
          id: 'elf_2',
          controller: 'p1',
          card: { name: 'Elvish Mystic', type_line: 'Creature — Elf Druid' },
        },
        {
          id: 'bear_1',
          controller: 'p1',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        },
      ],
    };

    expect(getCreatureCountManaAmount(state, city, 'p1')).toEqual({
      color: 'any_one_color',
      amount: 2,
      activationCost: '{2}',
    });
  });

  it('reports amount 0 when no creatures of the chosen type are controlled', () => {
    const city: any = {
      id: 'city_1',
      controller: 'p1',
      chosenCreatureType: 'Elf',
      card: {
        name: 'Three Tree City',
        type_line: 'Legendary Land',
        oracle_text: THREE_TREE_ORACLE,
      },
    };
    const state: any = {
      battlefield: [
        city,
        {
          id: 'bear_1',
          controller: 'p1',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        },
      ],
    };

    expect(getCreatureCountManaAmount(state, city, 'p1')).toEqual({
      color: 'any_one_color',
      amount: 0,
      activationCost: '{2}',
    });
    expect(buildManaProductionColorSelectionFields({
      totalAmount: 0,
      cardName: 'Three Tree City',
      colorMode: 'any_one_color',
    })).toBeNull();
  });

  it('builds a single-color choice for amount > 1 (not a WUBRG distribution)', () => {
    expect(buildManaProductionColorSelectionFields({
      totalAmount: 3,
      cardName: 'Three Tree City',
      colorMode: 'any_one_color',
    })).toEqual({
      selectionKind: 'any_color',
      description: 'Choose a color to add 3 mana from Three Tree City.',
      amount: 3,
      allowedColors: ['W', 'U', 'B', 'R', 'G'],
    });
  });
});

describe('buildAnyCombinationManaSelectionFields', () => {
  it('uses distribution when totalAmount is greater than 1 (Gwenna)', () => {
    expect(buildAnyCombinationManaSelectionFields({
      totalAmount: 2,
      cardName: 'Gwenna, Eyes of Gaea',
    })).toEqual({
      selectionKind: 'distribution',
      description: 'Choose how to distribute 2 mana from Gwenna, Eyes of Gaea.',
      totalAmount: 2,
      allowedColors: ['W', 'U', 'B', 'R', 'G'],
      availableColors: ['W', 'U', 'B', 'R', 'G'],
    });
  });

  it('uses any_color for a single mana (any_one_color)', () => {
    expect(buildAnyCombinationManaSelectionFields({
      totalAmount: 1,
      cardName: 'Lotus Petal',
    })).toMatchObject({
      selectionKind: 'any_color',
      amount: 1,
    });
  });

  it('restricts Vivi-style combination mana to U/R distribution', () => {
    expect(buildManaProductionColorSelectionFields({
      totalAmount: 4,
      cardName: 'Vivi Ornitier',
      colorMode: 'combination:U,R',
    })).toEqual({
      selectionKind: 'distribution',
      description: 'Choose how to distribute 4 mana from Vivi Ornitier.',
      totalAmount: 4,
      allowedColors: ['U', 'R'],
      availableColors: ['U', 'R'],
    });
  });
});

describe('resolveAllowedColorsForCombinationMana', () => {
  it('parses combination:U,R', () => {
    expect(resolveAllowedColorsForCombinationMana('combination:U,R')).toEqual(['U', 'R']);
  });

  it('defaults any_combination to all five colors', () => {
    expect(resolveAllowedColorsForCombinationMana('any_combination')).toEqual(['W', 'U', 'B', 'R', 'G']);
  });
});
