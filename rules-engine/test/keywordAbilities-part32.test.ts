import { describe, expect, it } from 'vitest';
import {
  ward,
  shouldTriggerWard,
  createWardTriggerResult,
  banding,
  createBand,
  canFormAttackingBand,
  countNonBandingMembers,
  createBandFormationResult,
  createBandDamageAssignment,
  createBandDamageAssignmentResult,
  fear,
  canBlockFear,
  canBlockAttackerWithFear,
  createFearBlockResult,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 32 (remaining Part 2 ward and combat restrictions)', () => {
  describe('Ward (702.21)', () => {
    it('should only trigger when an opponent targets the permanent', () => {
      expect(shouldTriggerWard(true, true)).toBe(true);
      expect(shouldTriggerWard(false, true)).toBe(false);
      expect(shouldTriggerWard(true, false)).toBe(false);
    });

    it('should summarize whether an unpaid ward trigger counters the spell or ability', () => {
      const ability = ward('vodalian-hexcatcher', '{1}');

      expect(createWardTriggerResult(ability, true)).toEqual({
        source: 'vodalian-hexcatcher',
        additionalCost: '{1}',
        costPaid: false,
        countered: true,
      });
      expect(createWardTriggerResult(ability, true, '{1}')).toEqual({
        source: 'vodalian-hexcatcher',
        additionalCost: '{1}',
        costPaid: true,
        countered: false,
      });
    });
  });

  describe('Banding (702.22)', () => {
    it('should count the nonbanding members in an attacking band and summarize formation legality', () => {
      expect(canFormAttackingBand(['mesa-pegasus', 'benalish-hero', 'savannah-lions'], ['mesa-pegasus', 'benalish-hero'])).toBe(true);
      expect(countNonBandingMembers(['mesa-pegasus', 'benalish-hero', 'savannah-lions'], ['mesa-pegasus', 'benalish-hero'])).toBe(1);

      const result = createBandFormationResult(
        ['mesa-pegasus', 'benalish-hero', 'savannah-lions'],
        ['mesa-pegasus', 'benalish-hero'],
        true,
        true
      );

      expect(result.memberIds).toEqual(['mesa-pegasus', 'benalish-hero', 'savannah-lions']);
      expect(result.nonBandingMembers).toBe(1);
      expect(result.canForm).toBe(true);
      expect(result.isAttacking).toBe(true);
    });

    it('should summarize invalid band damage assignments when the assigned total is short', () => {
      const band = createBand(['benalish-hero', 'mesa-pegasus'], true, true);
      const assignment = createBandDamageAssignment(band, 4, 'attacker', {
        'benalish-hero': 3,
      });

      expect(createBandDamageAssignmentResult(band, assignment)).toEqual({
        bandId: band.id,
        valid: false,
        assignedBy: 'attacker',
        totalDamageToAssign: 4,
        reason: 'Total damage assigned (3) doesn\'t equal damage to assign (4)',
      });
      expect(banding('benalish-hero').type).toBe('banding');
    });
  });

  describe('Fear (702.36)', () => {
    it('should preserve the base fear blocking restriction logic', () => {
      expect(canBlockFear(true, false)).toBe(true);
      expect(canBlockFear(false, true)).toBe(true);
      expect(canBlockFear(false, false)).toBe(false);
      expect(canBlockAttackerWithFear(false, false, false)).toBe(true);
    });

    it('should create a block summary that explains why the blocker is or is not eligible', () => {
      expect(createFearBlockResult('dross-crocodile', true, false, true)).toEqual({
        blockerId: 'dross-crocodile',
        canBlock: true,
        reason: 'black',
      });
      expect(createFearBlockResult('grizzly-bears', true, false, false)).toEqual({
        blockerId: 'grizzly-bears',
        canBlock: false,
        reason: 'not-eligible',
      });
      expect(fear('dross-golem').type).toBe('fear');
    });
  });
});