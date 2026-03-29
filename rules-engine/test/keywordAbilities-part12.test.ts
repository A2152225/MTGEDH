/**
 * Tests for Part 12 keyword abilities (Rules 702.170-702.176)
 */

import { describe, expect, it } from 'vitest';
import {
  canActivateSaddle,
  canCastPlotted,
  canCastPlottedNow,
  canCastWithFreerunning,
  canCastWithImpending,
  canChooseSpreeModes,
  canPlotCard,
  canPromiseGift,
  castImpending,
  castPlotted,
  castWithFreerunning,
  createOffspringToken,
  getChosenModes,
  getGiftRecipient,
  getGiftType,
  getSpreeCosts,
  getSpreeModeCount,
  giftsFood,
  GIFT_FOOD_TOKEN,
  hasRedundantFreerunning,
  hasRedundantGift,
  hasRedundantImpending,
  hasRedundantOffspring,
  hasRedundantPlot,
  hasRedundantSaddle,
  hasRedundantSpree,
  impending,
  isCreatureWithImpending,
  isPlotted,
  isSaddled,
  offspring,
  parseFreerunningCost,
  parseGiftType,
  parseImpending,
  parseOffspringCost,
  parsePlotCost,
  parseSaddleValue,
  payGift,
  payOffspring,
  plot,
  plotCard,
  removeImpendingCounter,
  resetSaddle,
  saddle,
  shouldCreateOffspringToken,
  shouldRemoveImpendingCounter,
  chooseSpreeModes,
  spree,
  freerunning,
  gift,
  wasOffspringPaid,
  wasFreerun,
  activateSaddle,
} from '../src/keywordAbilities';

describe('Part 12: Keyword Abilities (Rules 702.170-702.176)', () => {
  describe('Plot (702.170)', () => {
    it('should plot from hand and cast only on a later turn at sorcery speed', () => {
      const ability = plot('plot-card', '{2}{U}');
      const plotted = plotCard(ability, 3);
      const castable = castPlotted(plotted);

      expect(canPlotCard(ability, 'hand', true, true)).toBe(true);
      expect(canPlotCard(ability, 'graveyard', true, true)).toBe(false);
      expect(isPlotted(plotted)).toBe(true);
      expect(canCastPlotted(plotted, 3)).toBe(false);
      expect(canCastPlotted(plotted, 4)).toBe(true);
      expect(canCastPlottedNow(plotted, 4, true, true)).toBe(true);
      expect(canCastPlottedNow(plotted, 4, false, true)).toBe(false);
      expect(isPlotted(castable)).toBe(false);
      expect(parsePlotCost('Plot {2}{U} (You may exile this card from your hand...)')).toBe('{2}{U}');
      expect(hasRedundantPlot([ability, plot('other', '{1}{R}')])).toBe(false);
    });
  });

  describe('Saddle (702.171)', () => {
    it('should require enough total power and sorcery timing to become saddled', () => {
      const ability = saddle('mount', 4);
      const activated = activateSaddle(ability, ['c1', 'c2'], 5);

      expect(canActivateSaddle(ability, ['c1', 'c2'], 5, true)).toBe(true);
      expect(canActivateSaddle(ability, ['c1'], 3, true)).toBe(false);
      expect(canActivateSaddle(ability, ['c1', 'c2'], 5, false)).toBe(false);
      expect(isSaddled(activated!)).toBe(true);
      expect(activated?.saddledCreatures).toEqual(['c1', 'c2']);
      expect(isSaddled(resetSaddle(activated!))).toBe(false);
      expect(parseSaddleValue('Saddle 4')).toBe(4);
      expect(hasRedundantSaddle([ability, saddle('other', 3)])).toBe(false);
    });
  });

  describe('Spree (702.172)', () => {
    it('should choose one or more unique valid modes', () => {
      const ability = spree('spree-card', ['{R}', '{1}{R}', '{2}{R}']);
      const chosen = chooseSpreeModes(ability, [0, 1, 1]);

      expect(canChooseSpreeModes(ability, [0, 1])).toBe(true);
      expect(canChooseSpreeModes(ability, [])).toBe(false);
      expect(canChooseSpreeModes(ability, [3])).toBe(false);
      expect(getChosenModes(chosen)).toEqual([0, 1]);
      expect(getSpreeModeCount(chosen)).toBe(2);
      expect(getSpreeCosts(chosen)).toEqual(['{R}', '{1}{R}']);
      expect(hasRedundantSpree([ability, spree('other', ['{G}'])])).toBe(true);
    });
  });

  describe('Freerunning (702.173)', () => {
    it('should allow the alternate cost only after the qualifying combat damage condition', () => {
      const ability = freerunning('spell', '{1}{B}');
      const cast = castWithFreerunning(ability);

      expect(canCastWithFreerunning(true)).toBe(true);
      expect(canCastWithFreerunning(false)).toBe(false);
      expect(wasFreerun(cast)).toBe(true);
      expect(parseFreerunningCost('Freerunning {1}{B}')).toBe('{1}{B}');
      expect(hasRedundantFreerunning([ability, freerunning('other', '{2}{R}')])).toBe(false);
    });
  });

  describe('Gift (702.174)', () => {
    it('should promise a gift to an opponent and recognize Food gifts', () => {
      const ability = gift('spell', 'a Food');
      const paid = payGift(ability, 'p2');

      expect(canPromiseGift('p2')).toBe(true);
      expect(canPromiseGift('')).toBe(false);
      expect(getGiftRecipient(paid)).toBe('p2');
      expect(getGiftType(paid)).toBe('a Food');
      expect(giftsFood(paid)).toBe(true);
      expect(GIFT_FOOD_TOKEN.name).toBe('Food');
      expect(parseGiftType('Gift a Food')).toBe('a Food');
      expect(hasRedundantGift([ability, gift('other', 'a card')])).toBe(false);
    });
  });

  describe('Offspring (702.175)', () => {
    it('should track the additional cost and resulting 1/1 copy trigger', () => {
      const ability = offspring('creature', '{1}{G}');
      const paid = payOffspring(ability);
      const tokened = createOffspringToken(paid, 'token-1');

      expect(wasOffspringPaid(ability)).toBe(false);
      expect(wasOffspringPaid(paid)).toBe(true);
      expect(shouldCreateOffspringToken(paid)).toBe(true);
      expect(tokened.tokenId).toBe('token-1');
      expect(parseOffspringCost('Offspring {1}{G}')).toBe('{1}{G}');
      expect(hasRedundantOffspring([ability, offspring('other', '{2}{U}')])).toBe(false);
    });
  });

  describe('Impending (702.176)', () => {
    it('should cast with impending, suppress creature status, and tick down counters', () => {
      const ability = impending('creature', '{2}{U}', 4);
      const cast = castImpending(ability);
      const reduced = removeImpendingCounter(cast);

      expect(canCastWithImpending('hand')).toBe(true);
      expect(canCastWithImpending('graveyard')).toBe(false);
      expect(isCreatureWithImpending(ability)).toBe(true);
      expect(isCreatureWithImpending(cast)).toBe(false);
      expect(shouldRemoveImpendingCounter(cast)).toBe(true);
      expect(reduced.currentTimeCounters).toBe(3);
      expect(parseImpending('Impending 4—{2}{U}')).toEqual({ timeCounters: 4, cost: '{2}{U}' });
      expect(hasRedundantImpending([ability, impending('other', '{1}{R}', 3)])).toBe(false);
    });
  });
});