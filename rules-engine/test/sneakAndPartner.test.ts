/**
 * Tests for 2026 comprehensive-rules updates:
 * - Sneak (Rule 702.190)
 * - Partner-[text] matching (Rule 702.124i update: Character select)
 */

import { describe, it, expect } from 'vitest';
import {
  sneak,
  paySneak,
  canActivateSneak,
  wasSneakCast,
  hasRedundantSneak,
  partner,
  partnerWithRequirement,
  canPartnerTogether,
} from '../src/keywordAbilities';

describe('Sneak (Rule 702.190)', () => {
  it('creates sneak ability with cost', () => {
    const ability = sneak('card-1', '{2}{U}');

    expect(ability.type).toBe('sneak');
    expect(ability.source).toBe('card-1');
    expect(ability.sneakCost).toBe('{2}{U}');
    expect(ability.wasSneakPaid).toBe(false);
    expect(ability.entersTappedAndAttacking).toBe(false);
  });

  it('pays sneak by returning an unblocked attacker', () => {
    const ability = sneak('card-1', '{2}{U}');
    const paid = paySneak(ability, 'attacker-1');

    expect(paid.returnedCreatureId).toBe('attacker-1');
    expect(paid.wasSneakPaid).toBe(true);
    expect(paid.entersTappedAndAttacking).toBe(true);
    expect(wasSneakCast(paid)).toBe(true);
  });

  it('checks sneak activation timing/requirements', () => {
    expect(canActivateSneak(true, true)).toBe(true);
    expect(canActivateSneak(false, true)).toBe(false);
    expect(canActivateSneak(true, false)).toBe(false);
  });

  it('detects redundant sneak costs', () => {
    const a = sneak('card-a', '{2}{U}');
    const b = sneak('card-b', '{2}{U}');
    const c = sneak('card-c', '{1}{U}');

    expect(hasRedundantSneak([a, b])).toBe(true);
    expect(hasRedundantSneak([a, c])).toBe(false);
  });
});

describe('Partner text matching (Rule 702.124i)', () => {
  it('allows regular partner with regular partner', () => {
    expect(canPartnerTogether(partner('A'), partner('B'))).toBe(true);
  });

  it('allows matching Partner-Character select pair', () => {
    const a = partnerWithRequirement('A', 'Character select');
    const b = partnerWithRequirement('B', 'Character select');

    expect(canPartnerTogether(a, b)).toBe(true);
  });

  it('disallows mismatched Partner-[text] requirements', () => {
    const a = partnerWithRequirement('A', 'Character select');
    const b = partnerWithRequirement('B', 'Friends forever');

    expect(canPartnerTogether(a, b)).toBe(false);
  });

  it('disallows pairing Partner-[text] with plain partner', () => {
    const a = partnerWithRequirement('A', 'Character select');
    const b = partner('B');

    expect(canPartnerTogether(a, b)).toBe(false);
  });
});
