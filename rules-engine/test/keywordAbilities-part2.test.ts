import { describe, it, expect } from 'vitest';
import {
  // Ward
  ward, isWardCostPaid, hasRedundantWard,
  // Banding
  banding, canFormAttackingBand, canFormBlockingBand,
  // Rampage
  rampage, calculateRampageBonus, combinedRampageBonus,
  // Cumulative Upkeep
  cumulativeUpkeep, addAgeCounter, calculateUpkeepCost, hasRedundantCumulativeUpkeep,
  // Flanking
  flanking, doesFlankingTrigger, calculateFlankingPenalty,
  // Phasing
  phasing, phaseOut, phaseIn, isPhasedOut, hasRedundantPhasing,
  // Buyback
  buyback, payBuyback, shouldBuybackReturnToHand, hasRedundantBuyback,
  // Shadow
  shadow, canBlockWithShadow, canBeBlockedByShadow, hasRedundantShadow,
  // Cycling
  cycling, typecycling, hasRedundantCycling,
  // Echo
  echo, doesEchoTrigger, hasRedundantEcho,
  // Horsemanship
  horsemanship, canBlockHorsemanship, hasRedundantHorsemanship,
  // Fading
  fading, removeFadeCounter, shouldSacrificeForFading, hasRedundantFading,
  // Kicker
  kicker, payKicker, wasKicked, multikicker, payMultikicker, hasRedundantKicker,
  // Flashback
  flashback, castWithFlashback, shouldExileAfterFlashback, hasRedundantFlashback,
  // Madness
  madness, exileWithMadness, castWithMadness, shouldMoveToGraveyardFromMadness, hasRedundantMadness,
  // Fear
  fear, canBlockFear, hasRedundantFear,
  // Morph
  morph, megamorph, morphCastFaceDown, morphTurnFaceUp, getFaceDownStats, hasRedundantMorph,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 2 (Rules 702.21-702.37)', () => {
  describe('Ward (Rule 702.21)', () => {
    it('should create ward ability with cost', () => {
      const ability = ward('creature-1', '{2}');
      expect(ability.type).toBe('ward');
      expect(ability.cost).toBe('{2}');
      expect(ability.source).toBe('creature-1');
    });

    it('should check if ward cost was paid', () => {
      const ability = ward('creature-1', '{2}');
      expect(isWardCostPaid(ability, '{2}')).toBe(true);
      expect(isWardCostPaid(ability, '{1}')).toBe(false);
    });

    it('should detect redundant ward with same cost', () => {
      const ability1 = ward('creature-1', '{2}');
      const ability2 = ward('creature-1', '{2}');
      expect(hasRedundantWard([ability1, ability2])).toBe(true);
    });

    it('should allow multiple ward with different costs', () => {
      const ability1 = ward('creature-1', '{2}');
      const ability2 = ward('creature-1', 'Sacrifice a creature');
      expect(hasRedundantWard([ability1, ability2])).toBe(false);
    });
  });

  describe('Banding (Rule 702.22)', () => {
    it('should create banding ability', () => {
      const ability = banding('creature-1');
      expect(ability.type).toBe('banding');
    });

    it('should allow valid attacking band', () => {
      expect(canFormAttackingBand(['c1', 'c2'], ['c1', 'c2'])).toBe(true);
      expect(canFormAttackingBand(['c1', 'c2', 'c3'], ['c1', 'c2'])).toBe(true);
    });

    it('should reject invalid attacking band', () => {
      expect(canFormAttackingBand(['c1', 'c2', 'c3'], ['c1'])).toBe(false);
      expect(canFormAttackingBand(['c1'], [])).toBe(false);
    });
  });

  describe('Rampage (Rule 702.23)', () => {
    it('should create rampage ability', () => {
      const ability = rampage('creature-1', 2);
      expect(ability.type).toBe('rampage');
      expect(ability.bonus).toBe(2);
    });

    it('should calculate rampage bonus correctly', () => {
      const ability = rampage('creature-1', 2);
      expect(calculateRampageBonus(ability, 1)).toBe(0);
      expect(calculateRampageBonus(ability, 2)).toBe(2);
      expect(calculateRampageBonus(ability, 3)).toBe(4);
    });

    it('should combine multiple rampage abilities', () => {
      const ability1 = rampage('creature-1', 1);
      const ability2 = rampage('creature-1', 2);
      expect(combinedRampageBonus([ability1, ability2], 3)).toBe(6); // 1*(3-1) + 2*(3-1) = 2 + 4 = 6
    });
  });

  describe('Cumulative Upkeep (Rule 702.24)', () => {
    it('should create cumulative upkeep ability', () => {
      const ability = cumulativeUpkeep('permanent-1', '{1}');
      expect(ability.type).toBe('cumulativeUpkeep');
      expect(ability.ageCounters).toBe(0);
    });

    it('should add age counters', () => {
      const ability = cumulativeUpkeep('permanent-1', '{1}');
      const updated = addAgeCounter(ability);
      expect(updated.ageCounters).toBe(1);
    });

    it('should calculate cumulative cost', () => {
      const ability = addAgeCounter(addAgeCounter(cumulativeUpkeep('permanent-1', '{1}')));
      expect(calculateUpkeepCost(ability)).toBe('{1} × 2');
    });

    it('should not treat multiple instances as redundant', () => {
      const ability1 = cumulativeUpkeep('permanent-1', '{1}');
      const ability2 = cumulativeUpkeep('permanent-1', '{2}');
      expect(hasRedundantCumulativeUpkeep([ability1, ability2])).toBe(false);
    });
  });

  describe('Flanking (Rule 702.25)', () => {
    it('should create flanking ability', () => {
      const ability = flanking('creature-1');
      expect(ability.type).toBe('flanking');
    });

    it('should trigger when blocked by non-flanking creature', () => {
      expect(doesFlankingTrigger(false)).toBe(true);
      expect(doesFlankingTrigger(true)).toBe(false);
    });

    it('should calculate cumulative flanking penalty', () => {
      const penalty = calculateFlankingPenalty(2);
      expect(penalty.power).toBe(-2);
      expect(penalty.toughness).toBe(-2);
    });
  });

  describe('Phasing (Rule 702.26)', () => {
    it('should create phasing ability', () => {
      const ability = phasing('permanent-1');
      expect(ability.type).toBe('phasing');
      expect(ability.phasedOut).toBe(false);
    });

    it('should phase out and in', () => {
      const ability = phasing('permanent-1');
      const phasedOutAbility = phaseOut(ability);
      expect(isPhasedOut(phasedOutAbility)).toBe(true);
      
      const phasedInAbility = phaseIn(phasedOutAbility);
      expect(isPhasedOut(phasedInAbility)).toBe(false);
    });

    it('should treat multiple phasing as redundant', () => {
      const ability1 = phasing('permanent-1');
      const ability2 = phasing('permanent-1');
      expect(hasRedundantPhasing([ability1, ability2])).toBe(true);
    });
  });

  describe('Buyback (Rule 702.27)', () => {
    it('should create buyback ability', () => {
      const ability = buyback('spell-1', '{3}');
      expect(ability.type).toBe('buyback');
      expect(ability.wasPaid).toBe(false);
    });

    it('should track buyback payment', () => {
      const ability = buyback('spell-1', '{3}');
      const paid = payBuyback(ability);
      expect(shouldBuybackReturnToHand(paid)).toBe(true);
    });

    it('should treat multiple buyback as redundant', () => {
      const ability1 = buyback('spell-1', '{3}');
      const ability2 = buyback('spell-1', '{4}');
      expect(hasRedundantBuyback([ability1, ability2])).toBe(true);
    });
  });

  describe('Shadow (Rule 702.28)', () => {
    it('should create shadow ability', () => {
      const ability = shadow('creature-1');
      expect(ability.type).toBe('shadow');
    });

    it('should enforce shadow blocking restrictions', () => {
      expect(canBlockWithShadow(true, true)).toBe(true);
      expect(canBlockWithShadow(true, false)).toBe(false);
      expect(canBlockWithShadow(false, true)).toBe(false);
      expect(canBlockWithShadow(false, false)).toBe(true);
    });

    it('should treat multiple shadow as redundant', () => {
      const ability1 = shadow('creature-1');
      const ability2 = shadow('creature-1');
      expect(hasRedundantShadow([ability1, ability2])).toBe(true);
    });
  });

  describe('Cycling (Rule 702.29)', () => {
    it('should create cycling ability', () => {
      const ability = cycling('card-1', '{2}');
      expect(ability.type).toBe('cycling');
      expect(ability.cost).toBe('{2}');
    });

    it('should create typecycling ability', () => {
      const ability = typecycling('card-1', '{2}', 'Plains');
      expect(ability.type).toBe('typecycling');
      expect(ability.landType).toBe('Plains');
    });

    it('should not treat multiple cycling as redundant', () => {
      const ability1 = cycling('card-1', '{1}');
      const ability2 = cycling('card-1', '{2}');
      expect(hasRedundantCycling([ability1, ability2])).toBe(false);
    });
  });

  describe('Echo (Rule 702.30)', () => {
    it('should create echo ability', () => {
      const ability = echo('permanent-1', '{3}', 1);
      expect(ability.type).toBe('echo');
      expect(ability.turnEnteredControl).toBe(1);
    });

    it('should trigger echo during first upkeep', () => {
      const ability = echo('permanent-1', '{3}', 1);
      expect(doesEchoTrigger(ability, 2, 1)).toBe(true);
      expect(doesEchoTrigger(ability, 2, 2)).toBe(false);
    });

    it('should treat multiple echo as redundant', () => {
      const ability1 = echo('permanent-1', '{3}', 1);
      const ability2 = echo('permanent-1', '{4}', 1);
      expect(hasRedundantEcho([ability1, ability2])).toBe(true);
    });
  });

  describe('Horsemanship (Rule 702.31)', () => {
    it('should create horsemanship ability', () => {
      const ability = horsemanship('creature-1');
      expect(ability.type).toBe('horsemanship');
    });

    it('should enforce horsemanship blocking rules', () => {
      expect(canBlockHorsemanship(true)).toBe(true);
      expect(canBlockHorsemanship(false)).toBe(false);
    });

    it('should treat multiple horsemanship as redundant', () => {
      const ability1 = horsemanship('creature-1');
      const ability2 = horsemanship('creature-1');
      expect(hasRedundantHorsemanship([ability1, ability2])).toBe(true);
    });
  });

  describe('Fading (Rule 702.32)', () => {
    it('should create fading ability', () => {
      const ability = fading('permanent-1', 3);
      expect(ability.type).toBe('fading');
      expect(ability.fadeCounters).toBe(3);
    });

    it('should remove fade counters', () => {
      const ability = fading('permanent-1', 2);
      const updated = removeFadeCounter(ability);
      expect(updated?.fadeCounters).toBe(1);
    });

    it('should sacrifice when no counters remain', () => {
      const ability = fading('permanent-1', 1);
      const updated = removeFadeCounter(ability);
      const sacrificed = removeFadeCounter(updated!);
      expect(sacrificed).toBeNull();
    });

    it('should detect when permanent should be sacrificed', () => {
      const ability = fading('permanent-1', 0);
      expect(shouldSacrificeForFading(ability)).toBe(true);
    });

    it('should treat multiple fading as redundant', () => {
      const ability1 = fading('permanent-1', 3);
      const ability2 = fading('permanent-1', 2);
      expect(hasRedundantFading([ability1, ability2])).toBe(true);
    });
  });

  describe('Kicker (Rule 702.33)', () => {
    it('should create kicker ability', () => {
      const ability = kicker('spell-1', '{2}');
      expect(ability.type).toBe('kicker');
      expect(ability.wasPaid).toBe(false);
    });

    it('should track kicker payment', () => {
      const ability = kicker('spell-1', '{2}');
      const paid = payKicker(ability);
      expect(wasKicked(paid)).toBe(true);
    });

    it('should create multikicker ability', () => {
      const ability = multikicker('spell-1', '{1}');
      expect(ability.type).toBe('multikicker');
      expect(ability.timesPaid).toBe(0);
    });

    it('should track multikicker payments', () => {
      const ability = multikicker('spell-1', '{1}');
      const paid = payMultikicker(ability, 3);
      expect(paid.timesPaid).toBe(3);
    });

    it('should not treat multiple kicker as redundant', () => {
      const ability1 = kicker('spell-1', '{1}');
      const ability2 = kicker('spell-1', '{2}');
      expect(hasRedundantKicker([ability1, ability2])).toBe(false);
    });
  });

  describe('Flashback (Rule 702.34)', () => {
    it('should create flashback ability', () => {
      const ability = flashback('spell-1', '{3}{U}');
      expect(ability.type).toBe('flashback');
      expect(ability.wasCastWithFlashback).toBe(false);
    });

    it('should track flashback casting', () => {
      const ability = flashback('spell-1', '{3}{U}');
      const cast = castWithFlashback(ability);
      expect(shouldExileAfterFlashback(cast)).toBe(true);
    });

    it('should treat multiple flashback as redundant', () => {
      const ability1 = flashback('spell-1', '{3}{U}');
      const ability2 = flashback('spell-1', '{4}{U}');
      expect(hasRedundantFlashback([ability1, ability2])).toBe(true);
    });
  });

  describe('Madness (Rule 702.35)', () => {
    it('should create madness ability', () => {
      const ability = madness('card-1', '{1}{R}');
      expect(ability.type).toBe('madness');
      expect(ability.inMadnessExile).toBe(false);
    });

    it('should exile with madness when discarded', () => {
      const ability = madness('card-1', '{1}{R}');
      const exiled = exileWithMadness(ability);
      expect(exiled.inMadnessExile).toBe(true);
    });

    it('should cast from madness exile', () => {
      const ability = madness('card-1', '{1}{R}');
      const exiled = exileWithMadness(ability);
      const cast = castWithMadness(exiled);
      expect(cast.inMadnessExile).toBe(false);
    });

    it('should move to graveyard if madness not used', () => {
      const ability = madness('card-1', '{1}{R}');
      const exiled = exileWithMadness(ability);
      expect(shouldMoveToGraveyardFromMadness(exiled)).toBe(true);
    });

    it('should treat multiple madness as redundant', () => {
      const ability1 = madness('card-1', '{1}{R}');
      const ability2 = madness('card-1', '{2}{R}');
      expect(hasRedundantMadness([ability1, ability2])).toBe(true);
    });
  });

  describe('Fear (Rule 702.36)', () => {
    it('should create fear ability', () => {
      const ability = fear('creature-1');
      expect(ability.type).toBe('fear');
    });

    it('should enforce fear blocking restrictions', () => {
      expect(canBlockFear(true, false)).toBe(true);
      expect(canBlockFear(false, true)).toBe(true);
      expect(canBlockFear(false, false)).toBe(false);
    });

    it('should treat multiple fear as redundant', () => {
      const ability1 = fear('creature-1');
      const ability2 = fear('creature-1');
      expect(hasRedundantFear([ability1, ability2])).toBe(true);
    });
  });

  describe('Morph (Rule 702.37)', () => {
    it('should create morph ability', () => {
      const ability = morph('card-1', '{4}{G}');
      expect(ability.type).toBe('morph');
      expect(ability.isFaceDown).toBe(false);
    });

    it('should cast face down and turn face up', () => {
      const ability = morph('card-1', '{4}{G}');
      const faceDown = morphCastFaceDown(ability);
      expect(faceDown.isFaceDown).toBe(true);
      
      const faceUp = morphTurnFaceUp(faceDown);
      expect(faceUp.isFaceDown).toBe(false);
    });

    it('should provide correct face-down stats', () => {
      const stats = getFaceDownStats();
      expect(stats.power).toBe(2);
      expect(stats.toughness).toBe(2);
    });

    it('should create megamorph ability', () => {
      const ability = megamorph('card-1', '{5}{G}');
      expect(ability.type).toBe('megamorph');
    });

    it('should treat multiple morph as redundant', () => {
      const ability1 = morph('card-1', '{4}{G}');
      const ability2 = megamorph('card-1', '{5}{G}');
      expect(hasRedundantMorph([ability1, ability2])).toBe(true);
    });
  });
});
