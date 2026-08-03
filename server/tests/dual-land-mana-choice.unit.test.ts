import { describe, expect, it } from 'vitest';

import { calculateManaProduction } from '../src/socket/util.js';

describe('dual land mana production (choice, not all-at-once)', () => {
  it('Breeding Pool without abilityId requires a color choice and produces 1 mana', () => {
    const breedingPool = {
      id: 'bp1',
      controller: 'player1',
      card: {
        name: 'Breeding Pool',
        type_line: 'Land — Forest Island',
        oracle_text:
          "({T}: Add {G} or {U}.)\nAs Breeding Pool enters, you may pay 2 life. If you don't, it enters tapped.",
      },
    };

    const production = calculateManaProduction(
      { battlefield: [breedingPool] },
      breedingPool,
      'player1',
    );

    expect(production.requiresColorChoice).toBe(true);
    expect(production.baseAmount).toBe(1);
    expect(production.totalAmount).toBe(1);
    expect(production.colors.sort()).toEqual(['G', 'U']);
  });

  it('Botanical Sanctum without abilityId requires a color choice and produces 1 mana', () => {
    const sanctum = {
      id: 'bs1',
      controller: 'player1',
      card: {
        name: 'Botanical Sanctum',
        type_line: 'Land',
        oracle_text:
          '{T}: Add {G} or {U}.\nBotanical Sanctum enters tapped unless you control two or fewer other lands.',
      },
    };

    const production = calculateManaProduction(
      { battlefield: [sanctum] },
      sanctum,
      'player1',
    );

    expect(production.requiresColorChoice).toBe(true);
    expect(production.baseAmount).toBe(1);
    expect(production.totalAmount).toBe(1);
    expect(production.colors.sort()).toEqual(['G', 'U']);
  });

  it('narrows to the chosen color when provided', () => {
    const breedingPool = {
      id: 'bp2',
      controller: 'player1',
      card: {
        name: 'Breeding Pool',
        type_line: 'Land — Forest Island',
        oracle_text: '({T}: Add {G} or {U}.)',
      },
    };

    const production = calculateManaProduction(
      { battlefield: [breedingPool] },
      breedingPool,
      'player1',
      'U',
    );

    expect(production.requiresColorChoice).not.toBe(true);
    expect(production.colors).toEqual(['U']);
    expect(production.totalAmount).toBe(1);
  });
});
