import { describe, expect, it } from 'vitest';
import {
  deathtouch,
  isLethalDamageWithDeathtouch,
  shouldDestroyFromDeathtouch,
  createDeathtouchDamageResult,
  doubleStrike,
  dealsFirstStrikeDamage,
  dealsSecondStrikeDamage,
  preventsSecondStrike,
  createDoubleStrikeCombatResult,
  firstStrike,
  dealsOnlyInFirstStrikeStep,
  createFirstStrikeCombatResult,
  lifelink,
  calculateLifelinkGain,
  lifelinkFunctionsFromAllZones,
  createLifelinkResult,
  trample,
  calculateTrampleDamage,
  canAssignExcessTrampleDamage,
  assignsToPlayerWithNoBlockers,
  createTrampleDamageResult,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 33 (foundational combat damage helpers)', () => {
  describe('Deathtouch (702.2)', () => {
    it('should treat any positive damage as lethal and destroy creatures with toughness above zero', () => {
      expect(isLethalDamageWithDeathtouch(1, true)).toBe(true);
      expect(isLethalDamageWithDeathtouch(0, true)).toBe(false);
      expect(shouldDestroyFromDeathtouch(3, 1)).toBe(true);
      expect(shouldDestroyFromDeathtouch(0, 1)).toBe(false);
    });

    it('should summarize deathtouch combat damage outcomes', () => {
      expect(createDeathtouchDamageResult(deathtouch('acidic-slime'), 5, 1)).toEqual({
        source: 'acidic-slime',
        creatureToughness: 5,
        damageMarked: 1,
        lethalDamage: true,
        destroysCreature: true,
      });
    });
  });

  describe('Double Strike (702.4)', () => {
    it('should model first and second combat damage step participation', () => {
      expect(dealsFirstStrikeDamage(true, false)).toBe(true);
      expect(dealsSecondStrikeDamage(true, false, true)).toBe(true);
      expect(dealsSecondStrikeDamage(false, true, true)).toBe(false);
    });

    it('should summarize losing double strike before the second combat damage step', () => {
      expect(preventsSecondStrike(true, false, true)).toBe(true);
      expect(createDoubleStrikeCombatResult(doubleStrike('fencing-ace'), false, true, false)).toEqual({
        source: 'fencing-ace',
        dealsInFirstStep: false,
        dealsInSecondStep: false,
        removedBeforeSecondStep: true,
      });
      expect(createDoubleStrikeCombatResult(doubleStrike('boros-swiftblade'), false, false, true)).toEqual({
        source: 'boros-swiftblade',
        dealsInFirstStep: true,
        dealsInSecondStep: true,
        removedBeforeSecondStep: false,
      });
    });
  });

  describe('First Strike (702.7)', () => {
    it('should identify when first strike only applies to the first combat damage step', () => {
      expect(dealsOnlyInFirstStrikeStep(true, false)).toBe(true);
      expect(dealsOnlyInFirstStrikeStep(true, true)).toBe(false);
      expect(dealsOnlyInFirstStrikeStep(false, false)).toBe(false);
    });

    it('should summarize the combat-step participation from first strike', () => {
      expect(createFirstStrikeCombatResult(firstStrike('white-knight'))).toEqual({
        source: 'white-knight',
        dealsInFirstStep: true,
        dealsInSecondStep: false,
      });
      expect(createFirstStrikeCombatResult(firstStrike('skyhunter-skirmisher'), true).dealsInSecondStep).toBe(true);
    });
  });

  describe('Lifelink (702.15)', () => {
    it('should gain life equal to positive damage dealt and work from any zone', () => {
      expect(calculateLifelinkGain(4, true)).toBe(4);
      expect(calculateLifelinkGain(0, true)).toBe(0);
      expect(calculateLifelinkGain(4, false)).toBe(0);
      expect(lifelinkFunctionsFromAllZones()).toBe(true);
    });

    it('should summarize the resulting life gain from damage dealt', () => {
      expect(createLifelinkResult(lifelink('armadillo-cloak'), 3)).toEqual({
        source: 'armadillo-cloak',
        damageDealt: 3,
        lifeGained: 3,
      });
    });
  });

  describe('Trample (702.19)', () => {
    it('should split damage between blockers and excess damage to the defender', () => {
      expect(calculateTrampleDamage(6, 3)).toEqual({ blockerDamage: 3, excessDamage: 3 });
      expect(canAssignExcessTrampleDamage(6, 3)).toBe(true);
      expect(canAssignExcessTrampleDamage(3, 3)).toBe(false);
    });

    it('should summarize whether trample damage can reach the defender', () => {
      expect(assignsToPlayerWithNoBlockers(true, false)).toBe(true);
      expect(createTrampleDamageResult(trample('craw-wurm'), 7, 4, true)).toEqual({
        source: 'craw-wurm',
        blockerDamage: 4,
        excessDamage: 3,
        canAssignExcessToDefender: true,
      });
    });
  });
});