import { describe, expect, it } from 'vitest';
import {
  isEquipmentCreateTokenThenAttachOracle,
  isEtbCreatureTypeChoiceOracle,
} from '../src/state/modules/chosen-creature-type.js';
import { requiresCreatureTypeSelection } from '../src/socket/creature-type.js';

const midnightOracle =
  'When this Equipment enters, create a 1/1 white Soldier creature token, then attach this Equipment to it.\nEquipped creature gets +3/+3 and has flying and vigilance.\nEquip {3}';

describe('equipment create-then-attach is not creature-type choice', () => {
  it('recognizes Midnight Angel Armor pattern', () => {
    expect(isEquipmentCreateTokenThenAttachOracle(midnightOracle)).toBe(true);
  });

  it('does not require ETB creature-type selection', () => {
    expect(isEtbCreatureTypeChoiceOracle(midnightOracle)).toBe(false);
    expect(requiresCreatureTypeSelection({
      name: 'Midnight Angel Armor',
      oracle_text: midnightOracle,
    })).toEqual({ required: false, reason: '' });
  });
});
