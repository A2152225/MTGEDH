import { describe, expect, it } from 'vitest';

import {
  normalizeKickerManaCost,
  parseKickerCostOptions,
  sourceWasKicked,
  sourceWasKickedWithCost,
} from '../src/state/modules/kickerCostUtils.js';
import { isInterveningIfSatisfied } from '../src/state/modules/triggers/intervening-if.js';
import { resolveOnCastSpellTriggerDescriptions } from '../src/state/modules/onCastSpellTriggerUtils.js';

describe('kickerCostUtils', () => {
  it('parses Wastescape and/or kicker options', () => {
    const costs = parseKickerCostOptions('Kicker {G} and/or {1}{U}\nWhen you cast this spell...');
    expect(costs).toEqual(['{G}', '{1}{U}']);
  });

  it('normalizes mana cost spacing/case', () => {
    expect(normalizeKickerManaCost('{1}{u}')).toBe('{1}{U}');
  });

  it('matches specific paid kicker costs', () => {
    const source = { wasKicked: true, paidKickerCosts: ['{G}'] };
    expect(sourceWasKickedWithCost(source, '{G}')).toBe(true);
    expect(sourceWasKickedWithCost(source, '{1}{U}')).toBe(false);
    expect(sourceWasKicked({ wasKicked: false })).toBe(false);
  });
});

describe('on-cast kicker intervening-if', () => {
  const ctx = { state: { battlefield: [], players: [{ id: 'p1' }, { id: 'p2' }] } } as any;

  it('skips Mycospawn kicked clause when wasKicked is false', () => {
    const text =
      'When you cast this spell, if it was kicked, exile target land.';
    const satisfied = isInterveningIfSatisfied(ctx, 'p1', text, null, {
      wasKicked: false,
      stackItem: { wasKicked: false, card: { wasKicked: false } },
    } as any);
    expect(satisfied).toBe(false);
  });

  it('allows Mycospawn kicked clause when wasKicked is true', () => {
    const text =
      'When you cast this spell, if it was kicked, exile target land.';
    const satisfied = isInterveningIfSatisfied(ctx, 'p1', text, null, {
      wasKicked: true,
      stackItem: { wasKicked: true, card: { wasKicked: true } },
    } as any);
    expect(satisfied).toBe(true);
  });

  it('Wastescape G-kicker clause requires paid {G}', () => {
    const text =
      'When you cast this spell, if it was kicked with its {G} kicker, exile target artifact or enchantment an opponent controls.';
    expect(
      isInterveningIfSatisfied(ctx, 'p1', text, null, {
        stackItem: { wasKicked: true, paidKickerCosts: ['{G}'] },
      } as any),
    ).toBe(true);
    expect(
      isInterveningIfSatisfied(ctx, 'p1', text, null, {
        stackItem: { wasKicked: true, paidKickerCosts: ['{1}{U}'] },
      } as any),
    ).toBe(false);
  });

  it('queues both Wastescape clauses for later intervening-if filtering', () => {
    const card = {
      name: 'Wastescape Battlemage',
      oracle_text:
        'Kicker {G} and/or {1}{U}\n'
        + 'When you cast this spell, if it was kicked with its {G} kicker, exile target artifact or enchantment an opponent controls.\n'
        + "When you cast this spell, if it was kicked with its {1}{U} kicker, return target creature an opponent controls to its owner's hand.",
    };
    const all = resolveOnCastSpellTriggerDescriptions(card);
    expect(all).toHaveLength(2);
    expect(all[0].description).toMatch(/\{G\} kicker/i);
    expect(all[1].description).toMatch(/\{1\}\{U\} kicker/i);
  });
});
