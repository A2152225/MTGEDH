import { describe, expect, it } from 'vitest';

import {
  buildAnyCombinationManaSelectionFields,
} from '../src/state/modules/manaColorSelectionStepUtils.js';

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
});
