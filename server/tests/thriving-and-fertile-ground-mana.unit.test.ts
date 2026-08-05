import { describe, expect, it } from 'vitest';

import { calculateManaProduction } from '../src/socket/util.js';
import { getManaAbilitiesForPermanent } from '../src/state/modules/mana-abilities.js';
import { resolveManaAbilityActivationShape } from '../src/socket/interaction.js';

const THRIVING_GROVE_ORACLE = [
  'This land enters tapped. As it enters, choose a color other than green.',
  '{T}: Add {G} or one mana of the chosen color.',
].join('\n');

describe('Thriving Grove chosen-color mana', () => {
  const grove = {
    id: 'grove_1',
    controller: 'p1',
    chosenColor: 'red',
    card: {
      id: 'grove_card',
      name: 'Thriving Grove',
      type_line: 'Land',
      oracle_text: THRIVING_GROVE_ORACLE,
    },
  };

  it('registers G and chosen R as a color choice', () => {
    const abilities = getManaAbilitiesForPermanent({ battlefield: [grove] }, grove, 'p1');
    const choice = abilities.find((ability) => ability.id === 'native_choice_2') || abilities[0];
    expect(choice?.produces?.sort()).toEqual(['G', 'R']);
    expect(choice?.producesAllAtOnce).not.toBe(true);
  });

  it('calculateManaProduction offers G or R until a color is selected', () => {
    const production = calculateManaProduction({ battlefield: [grove] }, grove, 'p1');
    expect(production.requiresColorChoice).toBe(true);
    expect(production.baseAmount).toBe(1);
    expect(production.colors.sort()).toEqual(['G', 'R']);
  });

  it('narrows to R when that color is chosen at tap time', () => {
    const production = calculateManaProduction({ battlefield: [grove] }, grove, 'p1', 'R');
    expect(production.requiresColorChoice).not.toBe(true);
    expect(production.colors).toEqual(['R']);
  });

  it('activation shape keeps both colors for the printed thriving line', () => {
    const shape = resolveManaAbilityActivationShape(
      { battlefield: [grove] },
      grove,
      'p1',
      `${grove.card.id}-ability-0`,
      '{T}: Add {G} or one mana of the chosen color.',
      'Add {G} or one mana of the chosen color.',
      '{T}',
    );
    expect(shape.produces.sort()).toEqual(['G', 'R']);
    expect(shape.producesAllAtOnce).toBe(false);
    expect(shape.baseAmount).toBe(1);
  });
});

describe('Fertile Ground any-color bonus mana', () => {
  it('marks an unresolved any-color bonus without folding it into totalAmount', () => {
    const forest = {
      id: 'forest_1',
      controller: 'p1',
      card: {
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        oracle_text: '{T}: Add {G}.',
      },
    };
    const fertile = {
      id: 'fertile_1',
      controller: 'p1',
      attachedTo: 'forest_1',
      card: {
        name: 'Fertile Ground',
        type_line: 'Enchantment — Aura',
        oracle_text:
          'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional one mana of any color.',
      },
    };

    const production = calculateManaProduction(
      { battlefield: [forest, fertile] },
      forest,
      'p1',
    );

    expect(production.colors).toEqual(['G']);
    expect(production.baseAmount).toBe(1);
    expect(production.totalAmount).toBe(1);
    expect(production.requiresBonusColorChoice).toBe(true);
    expect(production.bonusMana).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: 'ANY', amount: 1 })]),
    );
  });

  it('keeps Fertile Ground bonus as ANY even when a land tap color is provided', () => {
    const forest = {
      id: 'forest_2',
      controller: 'p1',
      card: {
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        oracle_text: '{T}: Add {G}.',
      },
    };
    const fertile = {
      id: 'fertile_2',
      controller: 'p1',
      attachedTo: 'forest_2',
      card: {
        name: 'Fertile Ground',
        type_line: 'Enchantment — Aura',
        oracle_text:
          'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional one mana of any color.',
      },
    };

    const production = calculateManaProduction(
      { battlefield: [forest, fertile] },
      forest,
      'p1',
      'G',
    );

    expect(production.colors).toEqual(['G']);
    expect(production.totalAmount).toBe(1);
    expect(production.requiresBonusColorChoice).toBe(true);
    expect(production.bonusMana).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: 'ANY', amount: 1 })]),
    );
  });
});
