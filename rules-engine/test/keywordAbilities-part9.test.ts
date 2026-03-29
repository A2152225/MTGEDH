/**
 * Tests for Part 9 keyword abilities (Rules 702.141-702.150).
 */

import { describe, expect, it } from 'vitest';
import {
  activateBoast,
  activateEncore,
  applyCompleated,
  boast,
  canActivateBoast,
  canActivateEncore,
  canApplyCompleated,
  canAttackWithDecayed,
  canCastForetold,
  canCastWithDisturb,
  canDemonstrate,
  canForetellNow,
  canTrain,
  canTransformByDayNightCycle,
  castForetold,
  castWithCleave,
  castWithDisturb,
  cleave,
  compleated,
  daybound,
  decayed,
  declineDemonstrate,
  demonstrate,
  disturb,
  encore,
  entersBackFaceUp,
  entersTransformed,
  FORETELL_ACTION_COST,
  foretell,
  foretellCard,
  getBoastEffect,
  getCleaveCost,
  getCleavedText,
  getCompleatedLoyaltyReduction,
  getDemonstrateCopyIds,
  getDemonstrateOpponent,
  getDisturbCost,
  getEncoreAttackAssignments,
  getEncoreCost,
  getEncoreTokens,
  getEffectiveText,
  getForetellCost,
  getLoyaltyReduction,
  getTimesTrained,
  getTrainingPower,
  hasBeenEncored,
  hasDecayedAttacked,
  hasRedundantBoast,
  hasRedundantCleave,
  hasRedundantCompleated,
  hasRedundantDaybound,
  hasRedundantDecayed,
  hasRedundantDemonstrate,
  hasRedundantDisturb,
  hasRedundantEncore,
  hasRedundantForetell,
  hasRedundantNightbound,
  hasRedundantTraining,
  isBoasting,
  markAttacked,
  nightbound,
  parseBoastCost,
  parseCleaveCost,
  parseDisturbCost,
  parseEncoreCost,
  parseForetellCost,
  resetBoast,
  shouldBecomeDayFromDayboundPresence,
  shouldSacrificeDecayed,
  shouldTransformToDay,
  shouldTransformToNight,
  shouldTriggerTraining,
  training,
  triggerDecayed,
  triggerDemonstrate,
  triggerTraining,
  wasCleaved,
  wasDemonstrated,
  wasDisturbed,
  wasForetold,
} from '../src/keywordAbilities';

describe('Part 9: Keyword Abilities (Rules 702.141-702.150)', () => {
  describe('Encore (702.141)', () => {
    it('should activate from graveyard, create one token per opponent, and parse encore costs', () => {
      const ability = encore('card-1', '{5}{U}');
      const activated = activateEncore(ability, ['token-1', 'token-2']);

      expect(canActivateEncore('graveyard', true, 2)).toBe(true);
      expect(hasBeenEncored(activated)).toBe(true);
      expect(getEncoreTokens(activated)).toEqual(['token-1', 'token-2']);
      expect(getEncoreAttackAssignments(['p2', 'p3'], ['token-1', 'token-2'])).toEqual({ p2: 'token-1', p3: 'token-2' });
      expect(getEncoreCost(activated)).toBe('{5}{U}');
      expect(parseEncoreCost('Encore {5}{U}')).toBe('{5}{U}');
      expect(hasRedundantEncore([ability, encore('card-2', '{4}{U}')])).toBe(false);
    });
  });

  describe('Boast (702.142)', () => {
    it('should require an attack, activate once, and reset each turn', () => {
      const ability = boast('creature-1', '{1}{R}', 'Draw a card.');
      const attacked = markAttacked(ability);
      const activated = activateBoast(attacked);
      const reset = resetBoast(activated);

      expect(canActivateBoast(ability)).toBe(false);
      expect(canActivateBoast(attacked)).toBe(true);
      expect(isBoasting(activated)).toBe(true);
      expect(getBoastEffect(activated)).toBe('Draw a card.');
      expect(parseBoastCost('Boast — {1}{R}: Draw a card.')).toBe('{1}{R}');
      expect(reset.activatedThisTurn).toBe(false);
      expect(hasRedundantBoast([ability, boast('creature-2', '{2}{R}', 'Deal 2 damage.')])).toBe(false);
    });
  });

  describe('Foretell (702.143)', () => {
    it('should foretell from hand, wait until a later turn, and expose the foretell cost', () => {
      const ability = foretell('spell-1', '{1}{U}');
      const foretold = foretellCard(ability, 3);
      const cast = castForetold(foretold);

      expect(canForetellNow('hand', true, true)).toBe(true);
      expect(FORETELL_ACTION_COST).toBe('{2}');
      expect(wasForetold(foretold)).toBe(true);
      expect(canCastForetold(foretold, 4)).toBe(true);
      expect(getForetellCost(foretold)).toBe('{1}{U}');
      expect(parseForetellCost('Foretell {1}{U}')).toBe('{1}{U}');
      expect(wasForetold(cast)).toBe(false);
      expect(hasRedundantForetell([ability, foretell('spell-2', '{2}{U}')])).toBe(false);
    });
  });

  describe('Demonstrate (702.144)', () => {
    it('should copy the spell for you and a chosen opponent when demonstrated', () => {
      const ability = demonstrate('spell-1');
      const triggered = triggerDemonstrate(ability, 'p2', 'copy-you', 'copy-opponent');
      const declined = declineDemonstrate(ability);

      expect(canDemonstrate(['p2', 'p3'])).toBe(true);
      expect(wasDemonstrated(triggered)).toBe(true);
      expect(getDemonstrateOpponent(triggered)).toBe('p2');
      expect(getDemonstrateCopyIds(triggered)).toEqual(['copy-you', 'copy-opponent']);
      expect(wasDemonstrated(declined)).toBe(false);
      expect(hasRedundantDemonstrate([ability, demonstrate('spell-2')])).toBe(false);
    });
  });

  describe('Daybound and Nightbound (702.145)', () => {
    it('should track the day/night transform rules and first-day setup', () => {
      const dayboundAbility = daybound('wolf-1');
      const nightboundAbility = nightbound('wolf-1-back');

      expect(shouldTransformToNight(true, dayboundAbility.isFrontFace)).toBe(true);
      expect(shouldTransformToDay(true, nightboundAbility.isBackFace)).toBe(true);
      expect(entersTransformed(true)).toBe(true);
      expect(shouldBecomeDayFromDayboundPresence(true, false)).toBe(true);
      expect(canTransformByDayNightCycle(false)).toBe(true);
      expect(hasRedundantDaybound([dayboundAbility, daybound('wolf-2')])).toBe(true);
      expect(hasRedundantNightbound([nightboundAbility, nightbound('wolf-2-back')])).toBe(true);
    });
  });

  describe('Disturb (702.146)', () => {
    it('should cast transformed from the graveyard and enter with its back face up', () => {
      const ability = disturb('card-1', '{2}{W}');
      const cast = castWithDisturb(ability);

      expect(canCastWithDisturb('graveyard')).toBe(true);
      expect(wasDisturbed(cast)).toBe(true);
      expect(entersBackFaceUp(cast)).toBe(true);
      expect(getDisturbCost(cast)).toBe('{2}{W}');
      expect(parseDisturbCost('Disturb {2}{W}')).toBe('{2}{W}');
      expect(hasRedundantDisturb([ability, disturb('card-2', '{3}{W}')])).toBe(false);
    });
  });

  describe('Decayed (702.147)', () => {
    it('should forbid blocking and mark attacking creatures for sacrifice at end of combat', () => {
      const ability = decayed('zombie-1');
      const attacked = triggerDecayed(ability);

      expect(canAttackWithDecayed()).toBe(true);
      expect(hasDecayedAttacked(attacked)).toBe(true);
      expect(shouldSacrificeDecayed(attacked)).toBe(true);
      expect(hasRedundantDecayed([ability, decayed('zombie-2')])).toBe(true);
    });
  });

  describe('Cleave (702.148)', () => {
    it('should remove bracketed text when cast for its cleave cost', () => {
      const ability = cleave('spell-1', '{4}{W}', 'Destroy target [attacking] creature.');
      const cleavedText = getCleavedText('Destroy target [attacking] creature.');
      const cast = castWithCleave(ability, cleavedText);

      expect(cleavedText).toBe('Destroy target creature.');
      expect(wasCleaved(cast)).toBe(true);
      expect(getEffectiveText(cast)).toBe('Destroy target creature.');
      expect(getCleaveCost(cast)).toBe('{4}{W}');
      expect(parseCleaveCost('Cleave {4}{W}')).toBe('{4}{W}');
      expect(hasRedundantCleave([ability, cleave('spell-2', '{4}{W}', 'Other text')])).toBe(true);
    });
  });

  describe('Training (702.149)', () => {
    it('should trigger when a larger creature attacks alongside it and raise its power', () => {
      const ability = training('creature-1', 2);
      const triggered = triggerTraining(ability, 3);

      expect(shouldTriggerTraining(2, [1, 3])).toBe(true);
      expect(canTrain(2, [1, 3])).toBe(true);
      expect(getTimesTrained(triggered)).toBe(1);
      expect(getTrainingPower(triggered)).toBe(3);
      expect(hasRedundantTraining([ability, training('creature-2', 1)])).toBe(false);
    });
  });

  describe('Compleated (702.150)', () => {
    it('should reduce starting loyalty by two for each phyrexian symbol paid with life', () => {
      const ability = compleated('planeswalker-1');
      const applied = applyCompleated(ability, 2);

      expect(canApplyCompleated(2)).toBe(true);
      expect(getLoyaltyReduction(applied)).toBe(4);
      expect(getCompleatedLoyaltyReduction(applied)).toBe(4);
      expect(hasRedundantCompleated([ability, compleated('planeswalker-2')])).toBe(true);
    });
  });
});