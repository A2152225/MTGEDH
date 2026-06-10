import { describe, expect, it } from 'vitest';
import {
  applyPowerUpEnteredThisTurnDiscount,
  detectTeamworkAdditionalCost,
  parsePowerUpActivatedAbility,
  stripPowerUpReminderParenthetical,
  sumSelectedCreaturesPower,
} from '../src/state/modules/marvelMechanicsHelpers.js';

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

  it('applies entered-this-turn power-up discount by removing mana-value symbols', () => {
    const discounted = applyPowerUpEnteredThisTurnDiscount('{C}{W}{U}{B}{R}{G}', {
      enteredThisTurn: true,
      card: { cmc: 6 },
    });
    expect(discounted).toBe('');
  });

  it('sums selected creature power for teamwork validation', () => {
    const battlefield = [
      { id: 'c1', card: { type_line: 'Creature', power: '2' } },
      { id: 'c2', card: { type_line: 'Creature', power: '3' } },
    ];
    expect(sumSelectedCreaturesPower(battlefield, ['c1', 'c2'])).toBe(5);
  });
});
