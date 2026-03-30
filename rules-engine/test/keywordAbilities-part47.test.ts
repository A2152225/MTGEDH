import { describe, expect, it } from 'vitest';
import {
  clearHaunt,
  createFadingSummary,
  createHauntSummary,
  createPhasingSummary,
  createPhasedOutState,
  createUmbraArmorSummary,
  createVanishingSummary,
  fading,
  haunt,
  hauntCard,
  phaseOut,
  phasing,
  processFadingUpkeep,
  processVanishingUpkeep,
  umbraArmor,
  vanishing,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 47 (Part 15 summaries)', () => {
  describe('Phasing (702.26)', () => {
    it('should summarize phase-out state, timing, and visibility', () => {
      expect(createPhasingSummary(
        phaseOut(phasing('teferi-creature'), 'effect', 'player-a'),
        'player-a',
        'player-a',
        createPhasedOutState('teferi-creature', 'player-a', 'effect'),
      )).toEqual({
        source: 'teferi-creature',
        isPhasedOut: true,
        phasedOutBy: 'effect',
        canPhaseOut: false,
        canPhaseIn: true,
        permanentExists: false,
      });
    });
  });

  describe('Umbra Armor (702.89)', () => {
    it('should summarize replacement-effect applicability and prevented damage', () => {
      expect(createUmbraArmorSummary(umbraArmor('hyena-umbra'), true, 'silvercoat-lion', 5)).toEqual({
        source: 'hyena-umbra',
        canApply: true,
        enchantedPermanentId: 'silvercoat-lion',
        auraDestroyed: true,
        damageRemoved: 5,
      });
    });
  });

  describe('Fading (702.32)', () => {
    it('should summarize remaining fade counters and sacrifice state', () => {
      expect(createFadingSummary(processFadingUpkeep(fading('parallax-wave', 1)).ability!)).toEqual({
        source: 'parallax-wave',
        initialCounters: 1,
        countersRemaining: 0,
        canRemoveCounter: false,
        shouldSacrifice: true,
      });
    });
  });

  describe('Vanishing (702.63)', () => {
    it('should summarize remaining time counters and sacrifice state', () => {
      expect(createVanishingSummary(processVanishingUpkeep(vanishing('keldon-marauders', 2)).ability)).toEqual({
        source: 'keldon-marauders',
        initialCounters: 2,
        countersRemaining: 1,
        canRemoveCounter: true,
        shouldSacrifice: false,
      });
    });
  });

  describe('Haunt (702.55)', () => {
    it('should summarize haunted targets and leave-trigger readiness', () => {
      expect(createHauntSummary(clearHaunt(hauntCard(haunt('orzhov-pontiff'), 'target-creature')), 'target-creature')).toEqual({
        source: 'orzhov-pontiff',
        hauntedCard: undefined,
        isHaunting: false,
        canTriggerLeave: false,
        triggeredOnEntry: true,
        triggeredOnLeave: false,
      });
    });
  });
});