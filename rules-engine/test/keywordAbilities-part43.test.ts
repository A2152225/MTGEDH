import { describe, expect, it } from 'vitest';
import {
  activateExhaust,
  applySpeedSBA,
  castWithHarmonize,
  chooseTieredMode,
  createExhaustSummary,
  createHarmonizeSummary,
  createJobSelectSummary,
  createMaxSpeedSummary,
  createMobilizeSummary,
  createStartYourEnginesSummary,
  createTieredSummary,
  exhaust,
  harmonize,
  jobSelect,
  maxSpeed,
  mobilize,
  startYourEngines,
  tiered,
  triggerJobSelect,
  triggerMobilize,
  updateSpeed,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 43 (Part 13 summaries)', () => {
  describe('Exhaust (702.177)', () => {
    it('should summarize one-shot activation state for exhaust', () => {
      expect(createExhaustSummary(activateExhaust(exhaust('engine-1', '{3}', 'Add {R}{R}{R}'))!)).toEqual({
        source: 'engine-1',
        exhaustCost: '{3}',
        effect: 'Add {R}{R}{R}',
        canActivate: false,
        hasBeenActivated: true,
      });
    });
  });

  describe('Max Speed (702.178)', () => {
    it('should summarize threshold tracking and granted ability state', () => {
      expect(createMaxSpeedSummary(updateSpeed(maxSpeed('vehicle-1', 'Flying'), 4))).toEqual({
        source: 'vehicle-1',
        playerSpeed: 4,
        threshold: 4,
        grantedAbility: 'Flying',
        isActive: true,
      });
    });
  });

  describe('Start Your Engines! (702.179)', () => {
    it('should summarize the player speed floor and once-per-turn growth gate', () => {
      expect(createStartYourEnginesSummary(applySpeedSBA(startYourEngines('vehicle-2')))).toEqual({
        source: 'vehicle-2',
        hasSpeed: true,
        currentSpeed: 1,
        canIncreaseSpeed: true,
        speedTriggeredThisTurn: false,
      });
    });
  });

  describe('Harmonize (702.180)', () => {
    it('should summarize graveyard casting and generic cost reduction', () => {
      expect(createHarmonizeSummary(castWithHarmonize(harmonize('spell-1', '{2}{G}'), 'creature-1', 3), 'graveyard', '{4}{G}{G}')).toEqual({
        source: 'spell-1',
        harmonizeCost: '{2}{G}',
        canCastFromGraveyard: true,
        wasHarmonized: true,
        costReduction: 3,
        reducedCost: '{1}{G}{G}',
      });
    });
  });

  describe('Mobilize (702.181)', () => {
    it('should summarize token count and the tapped-and-attacking token pattern', () => {
      expect(createMobilizeSummary(triggerMobilize(mobilize('attacker-1', 3), ['token-1', 'token-2', 'token-3']))).toEqual({
        source: 'attacker-1',
        mobilizeValue: 3,
        tokenCount: 3,
        createsTappedAndAttackingTokens: true,
      });
    });
  });

  describe('Job Select (702.182)', () => {
    it('should summarize the ETB trigger and chosen Hero token id', () => {
      expect(createJobSelectSummary(triggerJobSelect(jobSelect('equipment-1'), 'hero-1'))).toEqual({
        source: 'equipment-1',
        hasTriggered: true,
        heroTokenId: 'hero-1',
      });
    });
  });

  describe('Tiered (702.183)', () => {
    it('should summarize chosen mode, chosen cost, and mode validity', () => {
      expect(createTieredSummary(chooseTieredMode(tiered('limit-break', ['{1}{R}', '{2}{R}{R}', '{4}{R}{R}']), 1), 1)).toEqual({
        source: 'limit-break',
        chosenMode: 1,
        chosenCost: '{2}{R}{R}',
        canChooseMode: true,
      });
    });
  });
});