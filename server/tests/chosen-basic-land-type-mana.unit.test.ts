import { describe, expect, it } from 'vitest';
import { calculateManaProduction } from '../src/socket/util.js';
import { getEffectiveBasicLandTypes } from '../../shared/src/landTypes.js';

describe('chosen basic land type mana', () => {
  it('grants Island mana after Thran Portal-style choice', () => {
    const portal = {
      id: 'portal_1',
      controller: 'p1',
      chosenBasicLandType: 'Island',
      card: {
        id: 'portal_card',
        name: 'Thran Portal',
        type_line: 'Land — Gate',
        oracle_text:
          'This land enters tapped unless you control two or fewer other lands.\nAs this land enters, choose a basic land type.\nThran Portal is the chosen type in addition to its other types.\n{T}: Add one mana of any color.',
      },
    };

    expect(getEffectiveBasicLandTypes(portal)).toEqual(['Island']);
    const production = calculateManaProduction({ battlefield: [portal] }, portal, 'p1');
    // Any-color printed ability still present; chosen type also contributes U.
    expect(production.colors).toEqual(expect.arrayContaining(['U']));
  });

  it('grants only chosen-type mana when land has no printed add ability', () => {
    const passage = {
      id: 'passage_1',
      controller: 'p1',
      chosenBasicLandType: 'Mountain',
      card: {
        id: 'passage_card',
        name: 'Multiversal Passage',
        type_line: 'Land',
        oracle_text:
          'As this land enters, choose a basic land type. Then you may pay 2 life. If you don\'t, it enters tapped.\nThis land is the chosen type.',
      },
    };

    expect(getEffectiveBasicLandTypes(passage)).toEqual(['Mountain']);
    const production = calculateManaProduction({ battlefield: [passage] }, passage, 'p1');
    expect(production.colors).toContain('R');
  });
});
