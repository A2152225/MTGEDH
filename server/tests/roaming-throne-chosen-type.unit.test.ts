import { describe, expect, it } from 'vitest';

import {
  permanentAddsChosenCreatureTypeToSelf,
  permanentHasCreatureType,
} from '../../shared/src/creatureTypes.js';
import { permanentHasSubtype } from '../../rules-engine/src/oracleIRExecutorCreatureStepUtils.js';

const throneOracle =
  'Ward {2}\n' +
  'As this creature enters, choose a creature type.\n' +
  'This creature is the chosen type in addition to its other types.\n' +
  'If a triggered ability of another creature you control of the chosen type triggers, it triggers an additional time.';

describe('Roaming Throne chosen-type-as-subtype', () => {
  it('counts Roaming Throne as the chosen creature type', () => {
    const throne = {
      chosenCreatureType: 'Merfolk',
      card: {
        name: 'Roaming Throne',
        type_line: 'Artifact Creature — Golem',
        oracle_text: throneOracle,
      },
    };

    expect(permanentAddsChosenCreatureTypeToSelf(throne)).toBe(true);
    expect(permanentHasCreatureType(throne, 'Merfolk')).toBe(true);
    expect(permanentHasCreatureType(throne, 'Golem')).toBe(true);
    expect(permanentHasSubtype(throne, 'merfolk')).toBe(true);
  });

  it('does not treat Cavern of Souls chosen type as an intrinsic creature type', () => {
    const cavern = {
      chosenCreatureType: 'Merfolk',
      card: {
        name: 'Cavern of Souls',
        type_line: 'Land',
        oracle_text:
          'As Cavern of Souls enters the battlefield, choose a creature type.\n' +
          "Each creature spell of the chosen type you cast can't be countered.",
      },
    };

    expect(permanentAddsChosenCreatureTypeToSelf(cavern)).toBe(false);
    expect(permanentHasCreatureType(cavern, 'Merfolk')).toBe(false);
  });
});
