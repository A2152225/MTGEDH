import { describe, expect, it } from 'vitest';

import {
  buildWarpPaymentAlternateCost,
  parseKeywordAlternateManaCost,
  parseWarpCost,
} from '../src/state/modules/alternate-costs.js';
import {
  calculateCostReduction,
  formatManaCostWithCostAdjustment,
} from '../src/socket/game-actions.js';

const EXALTED_SUNBORN_ORACLE =
  'Flying, lifelink\nIf one or more tokens would be created under your control, twice that many of those tokens are created instead.\nWarp {1}{W} (You may cast this card from your hand for its warp cost. Exile this creature at the beginning of the next end step, then you may cast it from exile on a later turn.)';

const EXALTED_SUNBORN = {
  id: 'exalted_sunborn_1',
  name: 'Exalted Sunborn',
  type_line: 'Creature — Angel',
  mana_cost: '{3}{W}{W}',
  colors: ['W'],
  oracle_text: EXALTED_SUNBORN_ORACLE,
};

describe('alternate-costs warp parsing', () => {
  it('parses Exalted Sunborn warp cost', () => {
    expect(parseWarpCost(EXALTED_SUNBORN_ORACLE)).toBe('{1}{W}');
    expect(parseKeywordAlternateManaCost(EXALTED_SUNBORN_ORACLE, 'warp')).toBe('{1}{W}');
  });

  it('reduces warp cost with Pearl Medallion', () => {
    const game = {
      state: {
        battlefield: [
          {
            id: 'pearl_medallion_1',
            controller: 'p1',
            card: {
              name: 'Pearl Medallion',
              type_line: 'Artifact',
              oracle_text: 'White spells you cast cost {1} less to cast.',
            },
          },
        ],
      },
    };

    const reduction = calculateCostReduction(game, 'p1', EXALTED_SUNBORN);
    const adjustedWarpCost = formatManaCostWithCostAdjustment('{1}{W}', reduction);
    expect(adjustedWarpCost).toBe('{W}');
    expect(buildWarpPaymentAlternateCost(adjustedWarpCost, EXALTED_SUNBORN_ORACLE)).toMatchObject({
      id: 'warp',
      manaCost: '{W}',
    });
  });

  it('reduces dash alternate cost with Pearl Medallion', () => {
    const game = {
      state: {
        battlefield: [
          {
            id: 'pearl_medallion_1',
            controller: 'p1',
            card: {
              name: 'Pearl Medallion',
              type_line: 'Artifact',
              oracle_text: 'White spells you cast cost {1} less to cast.',
            },
          },
        ],
      },
    };

    const card = {
      name: 'Aerial Responder',
      type_line: 'Creature — Dwarf Soldier',
      mana_cost: '{1}{W}',
      colors: ['W'],
      oracle_text: 'Flying\nDash {1}{W}',
    };

    const reduction = calculateCostReduction(game, 'p1', card);
    const adjustedDashCost = formatManaCostWithCostAdjustment('{1}{W}', reduction);
    expect(adjustedDashCost).toBe('{W}');
  });
});
