import { describe, expect, it } from 'vitest';
import {
  createMenaceBlockSummary,
  createProtectionDebtSummary,
  createReachBlockSummary,
  createVigilanceAttackSummary,
  menace,
  protectionFromColor,
  reach,
  vigilance,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 37 (static combat modifier summaries)', () => {
  describe('Menace (702.111)', () => {
    it('should summarize blocker counts against a menace attacker', () => {
      expect(createMenaceBlockSummary(menace('goblin-war-drums'), ['blocker-1'])).toEqual({
        source: 'goblin-war-drums',
        blockerCount: 1,
        minimumBlockers: 2,
        canBeBlocked: false,
        evasionRelevant: true,
      });
    });
  });

  describe('Reach (702.17)', () => {
    it('should summarize when reach matters against a flying attacker', () => {
      expect(createReachBlockSummary(reach('giant-spider'), true)).toEqual({
        source: 'giant-spider',
        attackerHasFlying: true,
        canBlock: true,
        usesReach: true,
      });
    });
  });

  describe('Vigilance (702.20)', () => {
    it('should summarize that vigilance attackers remain untapped', () => {
      expect(createVigilanceAttackSummary(vigilance('serra-angel'))).toEqual({
        source: 'serra-angel',
        tapsWhenAttacking: false,
        remainsUntapped: true,
      });
    });
  });

  describe('Protection (702.16)', () => {
    it('should summarize the full DEBT shield against a matching colored source', () => {
      expect(createProtectionDebtSummary(protectionFromColor('silver-knight', 'R'), { colors: ['R'] })).toEqual({
        source: 'silver-knight',
        quality: 'red',
        isProtected: true,
        preventsDamage: true,
        preventsEnchantEquip: true,
        preventsBlock: true,
        preventsTargeting: true,
        reason: 'Protected from source due to red',
      });
    });
  });
});