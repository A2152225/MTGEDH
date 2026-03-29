import { describe, expect, it } from 'vitest';
import {
  overload,
  payOverloadCost,
  isOverloaded,
  canCastWithOverload,
  getOverloadedText,
  createOverloadCastResult,
  scavenge,
  activateScavenge,
  canActivateScavenge,
  getScavengeCounters,
  createScavengeResolution,
  unleash,
  chooseToUnleash,
  isUnleashed,
  canBlock,
  shouldEnterUnleashed,
  getUnleashCounters,
  createUnleashResult,
  extort,
  payExtortCost,
  shouldTriggerExtort,
  getExtortCount,
  getExtortLifeLoss,
  calculateExtortLifeGain,
  resolveExtort,
  bestow,
  castWithBestow,
  revertToCreature,
  isBestowed,
  getEnchantedCreature,
  canCastWithBestow,
  getBestowMode,
  createBestowResolution,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 20 (Part 6 Batch 1/2 cost-choice helpers)', () => {
  describe('Overload (702.96)', () => {
    it('should only cast with overload from hand', () => {
      expect(canCastWithOverload('hand')).toBe(true);
      expect(canCastWithOverload('graveyard')).toBe(false);
      expect(canCastWithOverload('exile')).toBe(false);
    });

    it('should transform target text when overloaded', () => {
      const baseText = 'Return target nonland permanent you don\'t control to its owner\'s hand.';
      const overloaded = payOverloadCost(overload('cyclonic-rift', '{6}{U}'));

      expect(isOverloaded(overloaded)).toBe(true);
      expect(getOverloadedText(baseText)).toBe('Return each nonland permanent you don\'t control to its owner\'s hand.');
      expect(createOverloadCastResult(overloaded, baseText)).toEqual({
        source: 'cyclonic-rift',
        overloaded: true,
        effectiveText: 'Return each nonland permanent you don\'t control to its owner\'s hand.',
      });
    });
  });

  describe('Scavenge (702.97)', () => {
    it('should only activate from the graveyard at sorcery speed targeting a creature', () => {
      expect(canActivateScavenge('graveyard', true, true)).toBe(true);
      expect(canActivateScavenge('hand', true, true)).toBe(false);
      expect(canActivateScavenge('graveyard', false, true)).toBe(false);
      expect(canActivateScavenge('graveyard', true, false)).toBe(false);
    });

    it('should exile the card and add counters equal to power', () => {
      const scavenged = activateScavenge(scavenge('deadbridge-goliath', '{4}{G}{G}', [5, 5]), 'target-creature');

      expect(getScavengeCounters(scavenged)).toBe(5);
      expect(createScavengeResolution(scavenged, 'target-creature')).toEqual({
        source: 'deadbridge-goliath',
        target: 'target-creature',
        countersAdded: 5,
        exiledFromGraveyard: true,
      });
    });
  });

  describe('Unleash (702.98)', () => {
    it('should distinguish between entering unleashed and normal entry', () => {
      expect(shouldEnterUnleashed(true)).toBe(true);
      expect(shouldEnterUnleashed(false)).toBe(false);
    });

    it('should enter with a counter and lose the ability to block when unleashed', () => {
      const unleashed = chooseToUnleash(unleash('rakdos-cackler'));

      expect(isUnleashed(unleashed)).toBe(true);
      expect(getUnleashCounters(unleashed)).toBe(1);
      expect(canBlock(unleashed)).toBe(false);
      expect(createUnleashResult(unleashed)).toEqual({
        source: 'rakdos-cackler',
        entersWithCounter: true,
        canBlock: false,
      });
    });
  });

  describe('Extort (702.101)', () => {
    it('should trigger whenever you cast a spell', () => {
      expect(shouldTriggerExtort(true)).toBe(true);
      expect(shouldTriggerExtort(false)).toBe(false);
    });

    it('should track payments and mirror life lost and gained', () => {
      const paid = payExtortCost(extort('pontiff-of-blight'), 3);

      expect(getExtortCount(paid)).toBe(1);
      expect(getExtortLifeLoss(3)).toBe(3);
      expect(calculateExtortLifeGain(3)).toBe(3);
      expect(resolveExtort(paid, 3)).toEqual({
        source: 'pontiff-of-blight',
        opponentsLoseLife: 3,
        youGainLife: 3,
      });
    });
  });

  describe('Bestow (702.103)', () => {
    it('should only cast with bestow from hand with a legal target', () => {
      expect(canCastWithBestow('hand', true)).toBe(true);
      expect(canCastWithBestow('hand', false)).toBe(false);
      expect(canCastWithBestow('graveyard', true)).toBe(false);
    });

    it('should switch between aura and creature modes correctly', () => {
      const bestowed = castWithBestow(bestow('hopeful-eidolon', '{3}{W}', '{W}'), 'creature-1');
      const reverted = revertToCreature(bestowed);

      expect(isBestowed(bestowed)).toBe(true);
      expect(getEnchantedCreature(bestowed)).toBe('creature-1');
      expect(getBestowMode(bestowed)).toBe('aura');
      expect(createBestowResolution(bestowed)).toEqual({
        source: 'hopeful-eidolon',
        mode: 'aura',
        attachedTo: 'creature-1',
      });
      expect(getBestowMode(reverted)).toBe('creature');
      expect(getEnchantedCreature(reverted)).toBeUndefined();
    });
  });
});