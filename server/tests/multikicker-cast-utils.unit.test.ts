import { describe, expect, it } from 'vitest';

import {
  chooseMultikickerTimesForChargeInvest,
  expandManaCostWithMultikicker,
  getMultikickerChargeEntryCounters,
  isMultikickerChargeCounterManaInvest,
  parseMultikickerManaCost,
} from '../src/state/modules/multikickerCastUtils.js';

const EVERFLOWING_ORACLE =
  'Multikicker {2} (You may pay an additional {2} any number of times as you cast this spell.)\n' +
  'This artifact enters with a charge counter on it for each time it was kicked.\n' +
  '{T}: Add {C} for each charge counter on this artifact.';

describe('multikickerCastUtils', () => {
  it('parses multikicker mana cost and charge-invest pattern', () => {
    expect(parseMultikickerManaCost(EVERFLOWING_ORACLE)).toBe('{2}');
    expect(isMultikickerChargeCounterManaInvest(EVERFLOWING_ORACLE)).toBe(true);
    expect(expandManaCostWithMultikicker('{0}', '{2}', 3)).toBe('{0}{2}{2}{2}');
    expect(getMultikickerChargeEntryCounters(EVERFLOWING_ORACLE, 2)).toEqual({ charge: 2 });
    expect(getMultikickerChargeEntryCounters(EVERFLOWING_ORACLE, 0)).toBeNull();
  });

  it('chooses max affordable kick times from floating mana', () => {
    const game = {
      state: {
        manaPool: {
          ai1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 5 },
        },
        battlefield: [],
        zones: { ai1: { hand: [] } },
      },
    };

    expect(chooseMultikickerTimesForChargeInvest(game as any, 'ai1' as any, {
      oracle_text: EVERFLOWING_ORACLE,
      mana_cost: '{0}',
    })).toBe(2);
  });

  it('returns 0 kicks when charge invest cannot be afforded', () => {
    const game = {
      state: {
        manaPool: {
          ai1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
        },
        battlefield: [],
        zones: { ai1: { hand: [] } },
      },
    };

    expect(chooseMultikickerTimesForChargeInvest(game as any, 'ai1' as any, {
      oracle_text: EVERFLOWING_ORACLE,
      mana_cost: '{0}',
    })).toBe(0);
  });
});
