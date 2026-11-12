import { describe, expect, it } from 'vitest';

import { buildCostAdjustmentPlan } from '../src/state/modules/cost-adjustments.js';
import { calculateCostReduction } from '../src/socket/game-actions-handlers/gameActionsCastCostReduction.js';
import { applyCostAdjustment } from '../src/socket/game-actions-handlers/gameActionsCastCostFormatting.js';
import { parseManaCost } from '../src/state/modules/mana-check.js';
import {
  canActivateLoyaltyAbility,
  loyaltyAbilitiesLockedByStaticEffect,
} from '../src/state/modules/triggers/planeswalker-loyalty.js';
import { calculateAdditionalDraws } from '../src/state/modules/game-state-effects-handlers/gameStateEffectsLandPlayDraw.js';
import { collectStaticEffectSpecsFromState } from '../src/state/modules/staticEffectSpec.js';

const IMMORTAL_SUN_ORACLE =
  "Players can't activate planeswalkers' loyalty abilities.\nAt the beginning of your draw step, draw an additional card.\nSpells you cast cost {1} less to cast.\nCreatures you control get +1/+1.";

describe('The Immortal Sun cost reduction', () => {
  const immortalSun = {
    id: 'sun_1',
    controller: 'p1',
    card: {
      name: 'The Immortal Sun',
      type_line: 'Legendary Artifact',
      oracle_text: IMMORTAL_SUN_ORACLE,
    },
  };

  const boots = {
    name: 'Swiftfoot Boots',
    type_line: 'Artifact — Equipment',
    mana_cost: '{2}',
    colors: [],
  };

  it('matches hand cost plan and cast-payment calculateCostReduction', () => {
    const state = { battlefield: [immortalSun] };
    const plan = buildCostAdjustmentPlan(state, 'p1', boots);
    expect(plan.genericAdjustment).toBe(-1);

    const reduction = calculateCostReduction({ state }, 'p1', boots);
    expect(reduction.generic).toBe(1);
    expect(reduction.messages.some((message) => /immortal sun/i.test(message))).toBe(true);

    const reduced = applyCostAdjustment(parseManaCost('{2}'), reduction, 0);
    expect(reduced.generic).toBe(1);
  });

  it('does not double-count medallion reductions now shared via cost-adjustments', () => {
    const state = {
      battlefield: [
        {
          id: 'ruby_1',
          controller: 'p1',
          card: {
            name: 'Ruby Medallion',
            type_line: 'Artifact',
            oracle_text: 'Red spells you cast cost {1} less to cast.',
          },
        },
      ],
    };
    const bolt = {
      name: 'Lightning Bolt',
      type_line: 'Instant',
      mana_cost: '{R}',
      colors: ['R'],
    };

    const reduction = calculateCostReduction({ state }, 'p1', bolt);
    expect(reduction.generic).toBe(1);
  });

  it('locks planeswalker loyalty activations for all players', () => {
    const state = { battlefield: [immortalSun] };
    expect(loyaltyAbilitiesLockedByStaticEffect(state)).toBe(true);

    const walker = {
      id: 'walker_1',
      controller: 'p2',
      counters: { loyalty: 5 },
      card: {
        name: 'Test Walker',
        type_line: 'Legendary Planeswalker — Test',
        loyalty: 5,
        oracle_text: '+1: Draw a card.\n-2: Destroy target creature.',
      },
    };
    expect(canActivateLoyaltyAbility(walker, 0, state, 'p2').canActivate).toBe(false);
  });

  it('grants an additional draw on the controller draw step and a +1/+1 anthem', () => {
    const state = { battlefield: [immortalSun] };
    const ctx = { state } as any;
    expect(calculateAdditionalDraws(ctx, 'p1')).toBe(1);
    expect(calculateAdditionalDraws(ctx, 'p2')).toBe(0);

    const specs = collectStaticEffectSpecsFromState(state);
    expect(specs.some((spec: any) => {
      return String(spec?.sourcePermanentId || '') === 'sun_1'
        && spec?.scope?.kind === 'creatures_you_control'
        && Number(spec?.grant?.power || 0) === 1
        && Number(spec?.grant?.toughness || 0) === 1;
    })).toBe(true);
  });
});
