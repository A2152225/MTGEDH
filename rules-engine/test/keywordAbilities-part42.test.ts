import { describe, expect, it } from 'vitest';
import {
  activateCraft,
  activateSaddle,
  castImpending,
  castWithFreerunning,
  chooseSpreeModes,
  createGiftSummary,
  createImpendingSummary,
  createOffspringSummary,
  createPlotSummary,
  createSaddleSummary,
  createSpreeSummary,
  createFreerunningSummary,
  createCraftSummary,
  payGift,
  createOffspringToken,
  payOffspring,
  plot,
  plotCard,
  saddle,
  spree,
  freerunning,
  gift,
  offspring,
  impending,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 42 (Part 12 summaries)', () => {
  describe('Plot (702.170)', () => {
    it('should summarize plot availability and later free casting windows', () => {
      expect(createPlotSummary(plotCard(plot('plot-card', '{2}{U}'), 3), 'hand', 4, true, true)).toEqual({
        source: 'plot-card',
        plotCost: '{2}{U}',
        isPlotted: true,
        turnPlotted: 3,
        canPlotNow: false,
        canCastNow: true,
      });
    });
  });

  describe('Saddle (702.171)', () => {
    it('should summarize saddle readiness and the current saddled state', () => {
      expect(createSaddleSummary(activateSaddle(saddle('mount-1', 4), ['c1', 'c2'], 5)!, 5, true)).toEqual({
        source: 'mount-1',
        saddleValue: 4,
        isSaddled: true,
        saddledCreatureCount: 2,
        canActivate: true,
      });
    });
  });

  describe('Spree (702.172)', () => {
    it('should summarize selected modes, costs, and selection validity', () => {
      expect(createSpreeSummary(chooseSpreeModes(spree('spree-card', ['{R}', '{1}{R}', '{2}{R}']), [0, 1, 1]), [0, 1])).toEqual({
        source: 'spree-card',
        chosenModes: [0, 1],
        modeCount: 2,
        chosenCosts: ['{R}', '{1}{R}'],
        canChooseModes: true,
      });
    });
  });

  describe('Freerunning (702.173)', () => {
    it('should summarize the combat-damage gate and alternate-cost usage', () => {
      expect(createFreerunningSummary(castWithFreerunning(freerunning('spell-1', '{1}{B}')), true)).toEqual({
        source: 'spell-1',
        freerunningCost: '{1}{B}',
        qualifyingCombatDamageThisTurn: true,
        canCastWithFreerunning: true,
        wasFreerun: true,
      });
    });
  });

  describe('Gift (702.174)', () => {
    it('should summarize the chosen opponent and the Food-gift branch', () => {
      expect(createGiftSummary(payGift(gift('spell-1', 'a Food'), 'p2'))).toEqual({
        source: 'spell-1',
        giftType: 'a Food',
        chosenOpponent: 'p2',
        canPromiseGift: true,
        giftGiven: true,
        giftsFood: true,
      });
    });
  });

  describe('Offspring (702.175)', () => {
    it('should summarize payment and the resulting 1/1 copy trigger', () => {
      expect(createOffspringSummary(createOffspringToken(payOffspring(offspring('creature-1', '{1}{G}')), 'token-1'))).toEqual({
        source: 'creature-1',
        offspringCost: '{1}{G}',
        wasPaid: true,
        createsToken: true,
        tokenId: 'token-1',
      });
    });
  });

  describe('Impending (702.176)', () => {
    it('should summarize alternate casting, creature suppression, and counter removal', () => {
      expect(createImpendingSummary(castImpending(impending('creature-1', '{2}{U}', 4)), 'hand')).toEqual({
        source: 'creature-1',
        impendingCost: '{2}{U}',
        wasImpending: true,
        currentTimeCounters: 4,
        canCastWithImpending: true,
        isCreature: false,
        shouldRemoveCounter: true,
      });
    });
  });
});