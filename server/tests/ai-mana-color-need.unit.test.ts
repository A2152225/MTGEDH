import { describe, expect, it } from 'vitest';

import {
  collectAIManaColorNeedWeights,
  pickAIManaColorByNeedWeights,
  shouldAIPreferPaidScalingManaOverColorlessTap,
} from '../src/socket/ai-handlers/aiManaColorNeedHelpers.js';
import { chooseAIManaColorForActivation } from '../src/socket/ai-handlers/aiManaCostHelpers.js';

function emptyPool() {
  return { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
}

function gameWith(overrides: Record<string, unknown>) {
  return {
    state: {
      manaPool: { p1: emptyPool() },
      pendingSpellCasts: {},
      commandZone: {},
      zones: { p1: { hand: [] } },
      ...overrides,
    },
  };
}

describe('shouldAIPreferPaidScalingManaOverColorlessTap', () => {
  it('skips the {2} invest line when the chosen type count is 0', () => {
    expect(shouldAIPreferPaidScalingManaOverColorlessTap({
      producedAmount: 0,
      activationGenericCost: 2,
      neededColor: 'G',
    })).toBe(false);
  });

  it('needs 3 of the chosen type to break even, including when that color is needed', () => {
    expect(shouldAIPreferPaidScalingManaOverColorlessTap({
      producedAmount: 2,
      activationGenericCost: 2,
      neededColor: 'C',
    })).toBe(false);
    expect(shouldAIPreferPaidScalingManaOverColorlessTap({
      producedAmount: 2,
      activationGenericCost: 2,
      neededColor: 'R',
    })).toBe(false);
    expect(shouldAIPreferPaidScalingManaOverColorlessTap({
      producedAmount: 3,
      activationGenericCost: 2,
      neededColor: 'C',
    })).toBe(true);
    expect(shouldAIPreferPaidScalingManaOverColorlessTap({
      producedAmount: 3,
      activationGenericCost: 2,
      neededColor: 'R',
    })).toBe(true);
  });
});

describe('pickAIManaColorByNeedWeights', () => {
  it('does not pick unused U when the pending cost is Pantlaza colors', () => {
    const needs = { W: 100, U: 0, B: 0, R: 100, G: 100, C: 200 };
    expect(pickAIManaColorByNeedWeights(['W', 'U', 'B', 'R', 'G', 'C'], needs, emptyPool())).toBe('W');
  });

  it('prefers the needed color least already in the pool', () => {
    const needs = { W: 100, U: 0, B: 0, R: 100, G: 100, C: 200 };
    expect(pickAIManaColorByNeedWeights(
      ['W', 'U', 'B', 'R', 'G', 'C'],
      needs,
      { ...emptyPool(), green: 1, white: 1 },
    )).toBe('R');
  });

  it('prefers {C} when only generic mana is still needed', () => {
    const needs = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 100 };
    expect(pickAIManaColorByNeedWeights(['W', 'U', 'B', 'R', 'G', 'C'], needs, emptyPool())).toBe('C');
  });
});

describe('chooseAIManaColorForActivation need weighting', () => {
  it('picks among Pantlaza pips and prefers the missing color', () => {
    const pending = gameWith({
      pendingSpellCasts: {
        e1: { playerId: 'p1', manaCost: '{2}{R}{G}{W}' },
      },
    });
    expect(chooseAIManaColorForActivation(pending, 'p1' as any, ['W', 'U', 'B', 'R', 'G', 'C'])).toBe('W');

    const withPool = gameWith({
      manaPool: { p1: { ...emptyPool(), green: 1, white: 1 } },
      pendingSpellCasts: {
        e1: { playerId: 'p1', manaCost: '{2}{R}{G}{W}' },
      },
    });
    expect(chooseAIManaColorForActivation(withPool, 'p1' as any, ['W', 'U', 'B', 'R', 'G', 'C'])).toBe('R');
  });

  it('uses {C} for {1}{G} once green is already floating', () => {
    const game = gameWith({
      manaPool: { p1: { ...emptyPool(), green: 1 } },
      pendingSpellCasts: {
        e1: { playerId: 'p1', manaCost: '{1}{G}' },
      },
    });
    expect(chooseAIManaColorForActivation(game, 'p1' as any, ['W', 'U', 'B', 'R', 'G', 'C'])).toBe('C');
  });

  it('weights a commander still in the command zone', () => {
    const game = gameWith({
      commandZone: {
        p1: {
          inCommandZone: ['cmdr_1'],
          commanderCards: [{
            id: 'cmdr_1',
            name: 'Pantlaza, Sun-Favored',
            mana_cost: '{2}{R}{G}{W}',
          }],
        },
      },
    });
    const weights = collectAIManaColorNeedWeights(game, 'p1');
    expect(weights.R).toBeGreaterThan(0);
    expect(weights.G).toBeGreaterThan(0);
    expect(weights.W).toBeGreaterThan(0);
    expect(weights.U).toBe(0);
    expect(chooseAIManaColorForActivation(game, 'p1' as any, ['W', 'U', 'B', 'R', 'G', 'C'])).toBe('W');
  });

  it('keeps the old least-in-pool default when nothing is needed yet', () => {
    const game = gameWith({
      manaPool: { p1: { ...emptyPool(), white: 1 } },
    });
    expect(chooseAIManaColorForActivation(game, 'p1' as any, ['W', 'U', 'B', 'R', 'G', 'C'])).toBe('U');
  });
});
