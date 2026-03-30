import { describe, expect, it } from 'vitest';
import {
  cumulativeUpkeep,
  addAgeCounter,
  calculateUpkeepCost,
  createCumulativeUpkeepResult,
  flanking,
  shouldTriggerFlanking,
  calculateFlankingPenalty,
  getFlankingPenaltyForAbilities,
  createFlankingTriggerResult,
  kicker,
  payKicker,
  wasKicked,
  canCastWithKicker,
  createKickerCastResult,
  multikicker,
  payMultikicker,
  createMultikickerCastResult,
  flashback,
  castWithFlashback,
  shouldExileAfterFlashback,
  canCastWithFlashbackFromZone,
  createFlashbackCastResult,
  createFlashbackResolutionResult,
  madness,
  exileWithMadness,
  castWithMadness,
  shouldMoveToGraveyardFromMadness,
  canCastFromMadnessExile,
  createMadnessCastResult,
  createMadnessDeclineResult,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 31 (remaining Part 2 trigger and alt-cost helpers)', () => {
  describe('Cumulative Upkeep (702.24)', () => {
    it('should add an age counter and compute the new total upkeep cost', () => {
      const ability = addAgeCounter(cumulativeUpkeep('glacial-chasm', '{2}'));

      expect(ability.ageCounters).toBe(1);
      expect(calculateUpkeepCost(ability)).toBe('{2} × 1');
    });

    it('should summarize whether the permanent is sacrificed if upkeep is unpaid', () => {
      expect(createCumulativeUpkeepResult(cumulativeUpkeep('glacial-chasm', '{2}'), false)).toEqual({
        source: 'glacial-chasm',
        ageCounters: 1,
        totalCost: '{2} × 1',
        shouldSacrifice: true,
      });
      expect(createCumulativeUpkeepResult(cumulativeUpkeep('glacial-chasm', '{2}'), true)?.shouldSacrifice).toBe(false);
    });
  });

  describe('Flanking (702.25)', () => {
    it('should only trigger when a creature without flanking blocks', () => {
      expect(shouldTriggerFlanking(false, true)).toBe(true);
      expect(shouldTriggerFlanking(true, true)).toBe(false);
      expect(shouldTriggerFlanking(false, false)).toBe(false);
    });

    it('should summarize the combined flanking penalty from multiple abilities', () => {
      const abilities = [flanking('suq-ata-lancer'), flanking('suq-ata-lancer')];

      expect(calculateFlankingPenalty(2)).toEqual({ power: -2, toughness: -2 });
      expect(getFlankingPenaltyForAbilities(abilities)).toEqual({ power: -2, toughness: -2 });
      expect(createFlankingTriggerResult(abilities, 'blocker-1', false, true)).toEqual({
        blocker: 'blocker-1',
        penalty: { power: -2, toughness: -2 },
      });
    });
  });

  describe('Kicker (702.33)', () => {
    it('should only create a kicker cast result from hand after the cost is paid', () => {
      const paid = payKicker(kicker('orim\'s-thunder', '{R}'));

      expect(wasKicked(paid)).toBe(true);
      expect(canCastWithKicker(paid, 'hand')).toBe(true);
      expect(canCastWithKicker(paid, 'graveyard')).toBe(false);
      expect(createKickerCastResult(paid, 'hand')).toEqual({
        source: 'orim\'s-thunder',
        fromZone: 'hand',
        additionalCostPaid: '{R}',
        kicked: true,
      });
    });

    it('should summarize multikicker payments independently of normal kicker', () => {
      const paid = payMultikicker(multikicker('comet-storm', '{1}'), 3);

      expect(createMultikickerCastResult(paid, 'hand')).toEqual({
        source: 'comet-storm',
        fromZone: 'hand',
        costPerKick: '{1}',
        timesPaid: 3,
      });
    });
  });

  describe('Flashback (702.34)', () => {
    it('should only cast with flashback from the graveyard', () => {
      const cast = castWithFlashback(flashback('deep-analysis', '{1}{U}'));

      expect(shouldExileAfterFlashback(cast)).toBe(true);
      expect(canCastWithFlashbackFromZone(cast, 'graveyard')).toBe(true);
      expect(canCastWithFlashbackFromZone(cast, 'hand')).toBe(false);
    });

    it('should summarize both the cast and the exile-on-resolution replacement', () => {
      const cast = castWithFlashback(flashback('deep-analysis', '{1}{U}'));

      expect(createFlashbackCastResult(cast, 'graveyard')).toEqual({
        source: 'deep-analysis',
        fromZone: 'graveyard',
        alternativeCostPaid: '{1}{U}',
        usedFlashback: true,
      });
      expect(createFlashbackResolutionResult(cast)).toEqual({
        source: 'deep-analysis',
        destination: 'exile',
      });
    });
  });

  describe('Madness (702.35)', () => {
    it('should only cast with madness while the card remains in madness exile', () => {
      const exiled = exileWithMadness(madness('fiery-temper', '{R}'));

      expect(canCastFromMadnessExile(exiled)).toBe(true);
      expect(canCastFromMadnessExile(castWithMadness(exiled))).toBe(false);
    });

    it('should summarize both casting and declining the madness window', () => {
      const exiled = exileWithMadness(madness('fiery-temper', '{R}'));

      expect(createMadnessCastResult(exiled)).toEqual({
        source: 'fiery-temper',
        fromZone: 'exile',
        alternativeCostPaid: '{R}',
        usedMadness: true,
      });
      expect(shouldMoveToGraveyardFromMadness(exiled)).toBe(true);
      expect(createMadnessDeclineResult(exiled)).toEqual({
        source: 'fiery-temper',
        destination: 'graveyard',
      });
    });
  });
});