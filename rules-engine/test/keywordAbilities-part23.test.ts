import { describe, expect, it } from 'vitest';
import {
  forecast,
  canActivateForecastFromZone,
  activateForecast,
  resetForecast,
  createForecastActivationResult,
  ripple,
  getRippleRevealCount,
  getRippleMatchingCards,
  createRippleResolutionResult,
  splitSecond,
  canActDuringSplitSecond,
  canCastSpellDuringSplitSecond,
  canActivateAbilityDuringSplitSecond,
  createSplitSecondRestrictionResult,
  suspend,
  processSuspendUpkeep,
  canCastSuspendedFromZone,
  createSuspendedCastResult,
  delve,
  exileForDelve,
  getMaximumDelveReduction,
  createDelvePaymentResult,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 23 (Part 4 activation and cost helpers)', () => {
  describe('Forecast (702.57)', () => {
    it('should only activate from hand during your upkeep', () => {
      const ability = forecast('Pride of the Clouds', '{2}{W}{U}', 'Create a 1/1 Bird token');

      expect(canActivateForecastFromZone(ability, 'hand', true, true)).toBe(true);
      expect(canActivateForecastFromZone(ability, 'graveyard', true, true)).toBe(false);
      expect(canActivateForecastFromZone(ability, 'hand', false, true)).toBe(false);
      expect(createForecastActivationResult(ability, 'hand', true, true)).toEqual({
        source: 'Pride of the Clouds',
        costPaid: '{2}{W}{U}',
        effect: 'Create a 1/1 Bird token',
        activated: true,
      });
    });

    it('should remain locked for the turn after activation until reset', () => {
      const activated = activateForecast(forecast('Sky Hussar', '{2}{W}{U}', 'Draw a card'));

      expect(createForecastActivationResult(activated, 'hand', true, true)).toBeNull();
      expect(canActivateForecastFromZone(resetForecast(activated), 'hand', true, true)).toBe(true);
    });
  });

  describe('Ripple (702.60)', () => {
    it('should compute the reveal count from the current library size', () => {
      const ability = ripple('Surging Flame', 4);

      expect(getRippleRevealCount(ability, 10)).toBe(4);
      expect(getRippleRevealCount(ability, 2)).toBe(2);
    });

    it('should separate matching revealed cards from the rest', () => {
      const ability = ripple('Surging Flame', 4);

      expect(getRippleMatchingCards(['Surging Flame', 'Island', 'surging flame'], 'Surging Flame')).toEqual([
        'Surging Flame',
        'surging flame',
      ]);
      expect(createRippleResolutionResult(ability, ['Surging Flame', 'Island', 'surging flame'])).toEqual({
        source: 'Surging Flame',
        revealedCount: 3,
        matchingCards: ['Surging Flame', 'surging flame'],
        nonMatchingCards: ['Island'],
      });
    });
  });

  describe('Split Second (702.61)', () => {
    it('should prohibit casting spells and allow only mana abilities', () => {
      expect(canCastSpellDuringSplitSecond()).toBe(false);
      expect(canActivateAbilityDuringSplitSecond(true)).toBe(true);
      expect(canActivateAbilityDuringSplitSecond(false)).toBe(false);
      expect(canActDuringSplitSecond(true)).toBe(true);
      expect(canActDuringSplitSecond(false)).toBe(false);
    });

    it('should create a restriction summary for the split second spell', () => {
      expect(createSplitSecondRestrictionResult(splitSecond('Sudden Shock'))).toEqual({
        source: 'Sudden Shock',
        spellsProhibited: true,
        nonManaAbilitiesProhibited: true,
        manaAbilitiesAllowed: true,
      });
    });
  });

  describe('Suspend (702.62)', () => {
    it('should remove a time counter each upkeep until the card can be cast', () => {
      const firstUpkeep = processSuspendUpkeep(suspend('Rift Bolt', 2, '{R}'));
      const finalUpkeep = processSuspendUpkeep(firstUpkeep.ability);

      expect(firstUpkeep.removedCounter).toBe(true);
      expect(firstUpkeep.lastCounterRemoved).toBe(false);
      expect(firstUpkeep.canCast).toBe(false);
      expect(firstUpkeep.ability.timeCounters).toBe(1);
      expect(finalUpkeep.lastCounterRemoved).toBe(true);
      expect(finalUpkeep.canCast).toBe(true);
    });

    it('should only cast a suspended card from exile after the last counter is removed', () => {
      const ready = processSuspendUpkeep(suspend('Ancestral Vision', 1, '{U}')).ability;

      expect(canCastSuspendedFromZone(ready, 'exile')).toBe(true);
      expect(canCastSuspendedFromZone(ready, 'hand')).toBe(false);
      expect(createSuspendedCastResult(ready, 'exile')).toEqual({
        source: 'Ancestral Vision',
        fromZone: 'exile',
        withoutPayingManaCost: true,
      });
    });
  });

  describe('Delve (702.66)', () => {
    it('should cap delve reduction by both available cards and generic mana cost', () => {
      expect(getMaximumDelveReduction(8, 2)).toBe(2);
      expect(getMaximumDelveReduction(2, 5)).toBe(2);
      expect(getMaximumDelveReduction(0, 3)).toBe(0);
    });

    it('should create a payment result using only the generic portion of the cost', () => {
      const ability = exileForDelve(exileForDelve(exileForDelve(delve('Treasure Cruise'))));

      expect(createDelvePaymentResult(ability, 2)).toEqual({
        source: 'Treasure Cruise',
        cardsExiled: 3,
        genericReducedBy: 2,
        genericManaRemaining: 0,
      });
      expect(createDelvePaymentResult(ability, 5)).toEqual({
        source: 'Treasure Cruise',
        cardsExiled: 3,
        genericReducedBy: 3,
        genericManaRemaining: 2,
      });
    });
  });
});