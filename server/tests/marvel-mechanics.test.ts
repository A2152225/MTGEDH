import { describe, expect, it } from 'vitest';
import {
  applyManaCostReductionByManaCost,
  applyPowerUpActivationCostReductions,
  applyPowerUpDiscountsToActivationManaCost,
  applyPowerUpEnteredThisTurnDiscount,
  collectPowerUpStaticCostReductions,
  detectTeamworkAdditionalCost,
  hasUsedPowerUpAbility,
  markPowerUpAbilityUsed,
  maybeMarkPowerUpAbilityUsedFromActivationContext,
  parsePowerUpActivatedAbility,
  parsePowerUpOtherCreaturesCostReduction,
  resolvePowerUpActivationPricing,
  stripPowerUpReminderParenthetical,
  sumSelectedCreaturesPower,
} from '../src/state/modules/marvelMechanicsHelpers.js';
import { detectAdditionalCost } from '../src/socket/land-helpers.js';
import { resolveActivatedAbilityLineById } from '../src/socket/util.js';

describe('marvel mechanics helpers', () => {
  it('detects teamwork additional cost', () => {
    const info = detectTeamworkAdditionalCost(
      'Teamwork 3 (As an additional cost to cast this spell, you may tap any number of creatures you control with total power 3 or more.)\nDraw three cards.',
    );
    expect(info).toEqual({
      type: 'teamwork',
      amount: 3,
      teamworkMinPower: 3,
      teamworkIsOptional: true,
    });
  });

  it('parses power-up activated ability and strips reminder text', () => {
    const raw =
      'Power-up — {C}{W}{U}{B}{R}{G}: Put two +1/+1 counters on Thanos. (Activate each power-up ability only once. Reduce the cost by his mana cost if he entered this turn. Zero is even.)';
    const parsed = parsePowerUpActivatedAbility(raw);
    expect(parsed?.manaCost).toBe('{C}{W}{U}{B}{R}{G}');
    expect(parsed?.effectText).toContain('Put two +1/+1 counters on Thanos.');
    expect(stripPowerUpReminderParenthetical(raw)).toBe('Power-up — {C}{W}{U}{B}{R}{G}: Put two +1/+1 counters on Thanos.');
  });

  it('applies entered-this-turn power-up discount using full mana cost (118.7)', () => {
    const discounted = applyPowerUpEnteredThisTurnDiscount('{C}{W}{U}{B}{R}{G}', {
      enteredThisTurn: true,
      card: { mana_cost: '{C}{W}{U}{B}{R}{G}', cmc: 6 },
    });
    expect(discounted).toBe('');
  });

  it('applies 118.7 colored-then-generic reduction for partial overlap', () => {
    expect(applyManaCostReductionByManaCost('{2}{W}', '{W}{U}')).toBe('{1}');
  });

  it('parses static power-up cost reduction text', () => {
    expect(
      parsePowerUpOtherCreaturesCostReduction(
        'Power-up abilities of other creatures you control cost {3} less to activate.',
      ),
    ).toBe('{3}');
  });

  it('collects static power-up reductions from other controlled permanents', () => {
    const state = {
      battlefield: [
        {
          id: 'thanos',
          controller: 'p1',
          card: { oracle_text: 'Power-up — {6}: Do things.' },
        },
        {
          id: 'ally',
          controller: 'p1',
          card: {
            oracle_text: 'Power-up abilities of other creatures you control cost {2} less to activate.',
          },
        },
      ],
    };
    expect(collectPowerUpStaticCostReductions(state, 'p1', 'thanos')).toEqual(['{2}']);
    expect(applyPowerUpActivationCostReductions('{2}{R}{R}', state, 'p1', 'thanos')).toBe('{R}{R}');
  });

  it('sums selected creature power for teamwork validation', () => {
    const battlefield = [
      { id: 'c1', card: { type_line: 'Creature', power: '2' } },
      { id: 'c2', card: { type_line: 'Creature', power: '3' } },
    ];
    expect(sumSelectedCreaturesPower(battlefield, ['c1', 'c2'])).toBe(5);
  });

  it('routes teamwork through detectAdditionalCost', () => {
    const info = detectAdditionalCost(
      'Teamwork 2 (As an additional cost to cast this spell, you may tap any number of creatures you control with total power 2 or more.)\nDraw two cards.',
    );
    expect(info).toEqual({
      type: 'teamwork',
      amount: 0,
      teamworkMinPower: 2,
      teamworkIsOptional: true,
    });
  });

  it('tracks used power-up abilities per index', () => {
    const permanent: any = {};
    expect(hasUsedPowerUpAbility(permanent, 0)).toBe(false);
    markPowerUpAbilityUsed(permanent, 0);
    expect(hasUsedPowerUpAbility(permanent, 0)).toBe(true);
    expect(hasUsedPowerUpAbility(permanent, 1)).toBe(false);
  });

  it('resolves power-up lines by generic ability id', () => {
    const permanent = {
      card: {
        oracle_text: 'Power-up — {2}{R}: Draw a card.\n{T}: Add {R}.',
      },
    };
    const resolved = resolveActivatedAbilityLineById(permanent, 'card-ability-0');
    expect(resolved?.costText).toBe('{2}{R}');
    expect(resolved?.effectText).toBe('Draw a card.');
  });

  it('resolvePowerUpActivationPricing applies ETB and static reductions', () => {
    const thanos = {
      id: 'thanos',
      controller: 'p1',
      enteredThisTurn: true,
      card: {
        mana_cost: '{6}',
        oracle_text: 'Power-up — {2}{R}{R}: Draw a card.',
      },
    };
    const ally = {
      id: 'ally',
      controller: 'p1',
      card: {
        oracle_text: 'Power-up abilities of other creatures you control cost {1} less to activate.',
      },
    };
    const state = { battlefield: [thanos, ally] };
    const pricing = resolvePowerUpActivationPricing(thanos, state, 'p1', {
      activatedAbilityText: 'Power-up — {2}{R}{R}: Draw a card.',
      abilityId: 'thanos-ability-0',
    });
    expect(pricing?.powerUpAbilityIndex).toBe(0);
    // ETB {6} discount clears generic; static {1} cannot reduce colored-only remainder.
    expect(pricing?.discountedManaCost).toBe('{R}{R}');
  });

  it('resolvePowerUpActivationPricing applies static reductions to generic portions', () => {
    const creature = {
      id: 'hero',
      controller: 'p1',
      card: { oracle_text: 'Power-up — {3}{R}: Draw a card.' },
    };
    const ally = {
      id: 'ally',
      controller: 'p1',
      card: {
        oracle_text: 'Power-up abilities of other creatures you control cost {2} less to activate.',
      },
    };
    const pricing = resolvePowerUpActivationPricing(creature, { battlefield: [creature, ally] }, 'p1', {
      activatedAbilityText: 'Power-up — {3}{R}: Draw a card.',
      abilityId: 'hero-ability-0',
    });
    expect(pricing?.discountedManaCost).toBe('{1}{R}');
  });

  it('applyPowerUpDiscountsToActivationManaCost leaves non-power-up costs unchanged', () => {
    const permanent = {
      id: 'goblin',
      controller: 'p1',
      card: { oracle_text: '{R}: Draw a card.' },
    };
    expect(
      applyPowerUpDiscountsToActivationManaCost('{R}', permanent, { battlefield: [permanent] }, 'p1', {
        activatedAbilityText: '{R}: Draw a card.',
      }),
    ).toBe('{R}');
  });

  it('maybeMarkPowerUpAbilityUsedFromActivationContext marks once-per index', () => {
    const game = {
      state: {
        battlefield: [{
          id: 'thanos',
          controller: 'p1',
          card: { oracle_text: 'Power-up — {2}{R}: Draw a card.' },
        }],
      },
    };
    maybeMarkPowerUpAbilityUsedFromActivationContext(game, 'p1', 'thanos', {
      activatedAbilityText: 'Power-up — {2}{R}: Draw a card.',
      abilityId: 'thanos-ability-0',
    });
    expect(hasUsedPowerUpAbility(game.state.battlefield[0], 0)).toBe(true);
    maybeMarkPowerUpAbilityUsedFromActivationContext(game, 'p1', 'thanos', {
      activatedAbilityText: 'Power-up — {2}{R}: Draw a card.',
      abilityId: 'thanos-ability-0',
    });
    expect(hasUsedPowerUpAbility(game.state.battlefield[0], 0)).toBe(true);
  });
});
