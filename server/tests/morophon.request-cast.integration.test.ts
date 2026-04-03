import { describe, expect, it } from 'vitest';

import { calculateCostReduction, formatManaCostWithReduction } from '../src/socket/game-actions.js';

describe('Morophon WUBRG alternate cost handling', () => {
  it('reduces a WUBRG alternate cost to {0} while leaving normal generic mana intact', () => {
    const game = {
      state: {
        battlefield: [
          {
            id: 'morophon_1',
            controller: 'p1',
            chosenCreatureType: 'Merfolk',
            card: {
              name: 'Morophon, the Boundless',
              oracle_text: 'Changeling As Morophon, the Boundless enters, choose a creature type. Spells you cast of the chosen type cost {W}{U}{B}{R}{G} less to cast. This effect reduces only the amount of colored mana you pay. Other creatures you control of the chosen type get +1/+1.',
            },
          },
        ],
      },
    } as any;

    const hakbal = {
      name: 'Hakbal of the Surging Soul',
      mana_cost: '{1}{G}{U}',
      type_line: 'Legendary Creature — Merfolk Scout',
      oracle_text: 'At the beginning of combat on your turn, each Merfolk you control explores.',
    };

    const reduction = calculateCostReduction(game, 'p1', hakbal, false);

    expect(formatManaCostWithReduction('{1}{G}{U}', reduction)).toBe('{1}');
    expect(formatManaCostWithReduction('{W}{U}{B}{R}{G}', reduction)).toBe('{0}');
  });
});