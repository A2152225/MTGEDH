import { describe, expect, it } from 'vitest';
import { getTypeSpecificFields } from '../src/socket/resolutionStepTypeSpecificFieldsUtils.js';
import { getAffordableXHintForCostPerX } from '../src/state/modules/spellXCastUtils.js';
import { ResolutionStepType } from '../src/state/resolution/index.js';

describe('X prompt for "you may pay {X}" lifegain cards', () => {
  it('forwards minX/maxX/costPerX and uses maxX as the slider bound when no explicit max exists', () => {
    const fields: any = getTypeSpecificFields({
      id: 's1', type: ResolutionStepType.X_VALUE_SELECTION, playerId: 'p1', minX: 0, maxX: 3, costPerX: '{1}',
    } as any);
    expect(fields.costPerX).toBe('{1}');
    expect(fields.maxValue).toBe(3);
    expect(fields.minValue).toBe(0);
  });

  it('explicit min/max values win over minX/maxX', () => {
    const fields: any = getTypeSpecificFields({
      id: 's1', type: ResolutionStepType.X_VALUE_SELECTION, playerId: 'p1', minValue: 1, maxValue: 5, minX: 0, maxX: 9, costPerX: '{1}',
    } as any);
    expect(fields.minValue).toBe(1);
    expect(fields.maxValue).toBe(5);
  });

  it('affordable hint counts generic mana the player can spend per X', () => {
    const game: any = {
      state: {
        players: [{ id: 'p1' }],
        battlefield: [],
        zones: { p1: { hand: [], graveyard: [] } },
        manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 } },
      },
    };
    expect(getAffordableXHintForCostPerX(game, 'p1', '{1}', 3)).toBe(2);
    expect(getAffordableXHintForCostPerX(game, 'p1', '{1}', 1)).toBe(1);
    expect(getAffordableXHintForCostPerX(game, 'p1', '{G}', 3)).toBeUndefined();
  });
});