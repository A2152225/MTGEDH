import { describe, expect, it } from 'vitest';
import {
  defender,
  canAttackDespiteDefender,
  createDefenderAttackResult,
  flash,
  canCastCardNow,
  createFlashTimingResult,
  flying,
  isFlyingEvasionRelevant,
  createFlyingBlockResult,
  haste,
  usesHasteToIgnoreSummoningSickness,
  createHasteActionResult,
  hexproof,
  isBlockedByHexproofQuality,
  createHexproofTargetingResult,
  indestructible,
  survivesIndestructibleChecks,
  createIndestructibleDestructionResult,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 34 (combat access and protection helpers)', () => {
  describe('Defender (702.3)', () => {
    it('should distinguish normal defender restrictions from explicit attack overrides', () => {
      expect(canAttackDespiteDefender(true, false)).toBe(false);
      expect(canAttackDespiteDefender(true, true)).toBe(true);
      expect(canAttackDespiteDefender(false, false)).toBe(true);
    });

    it('should summarize when defender is being bypassed', () => {
      expect(createDefenderAttackResult(defender('rolling-stones-wall'), true)).toEqual({
        source: 'rolling-stones-wall',
        ignoresDefenderRestriction: true,
        canAttack: true,
      });
    });
  });

  describe('Flash (702.8)', () => {
    it('should model when flash is needed to cast a card outside main-phase timing', () => {
      expect(canCastCardNow(true, false, true)).toBe(true);
      expect(canCastCardNow(false, false, true)).toBe(false);
      expect(canCastCardNow(false, true, false)).toBe(true);
    });

    it('should summarize casting windows opened by flash timing', () => {
      expect(createFlashTimingResult(flash('ambush-viper'), false, true)).toEqual({
        source: 'ambush-viper',
        canCastNow: true,
        requiresFlashTiming: true,
      });
    });
  });

  describe('Flying (702.9)', () => {
    it('should identify when flying creates real evasion pressure', () => {
      expect(isFlyingEvasionRelevant(true, false, false)).toBe(true);
      expect(isFlyingEvasionRelevant(true, false, true)).toBe(false);
      expect(isFlyingEvasionRelevant(false, false, false)).toBe(false);
    });

    it('should summarize whether a flying attacker can be blocked', () => {
      expect(createFlyingBlockResult(flying('snapping-drake'), false, true)).toEqual({
        source: 'snapping-drake',
        blockerHasFlying: false,
        blockerHasReach: true,
        canBeBlocked: true,
        evasionRelevant: false,
      });
    });
  });

  describe('Haste (702.10)', () => {
    it('should identify when haste is actively bypassing summoning sickness', () => {
      expect(usesHasteToIgnoreSummoningSickness(true, false)).toBe(true);
      expect(usesHasteToIgnoreSummoningSickness(true, true)).toBe(false);
      expect(usesHasteToIgnoreSummoningSickness(false, false)).toBe(false);
    });

    it('should summarize haste-enabled attack and tap activation access', () => {
      expect(createHasteActionResult(haste('ball-lightning'), false)).toEqual({
        source: 'ball-lightning',
        canAttack: true,
        canActivateTapAbilities: true,
        usesHaste: true,
      });
    });
  });

  describe('Hexproof (702.11)', () => {
    it('should detect when quality-based hexproof stops targeting', () => {
      expect(isBlockedByHexproofQuality('blue', 'blue', 'artifact')).toBe(true);
      expect(isBlockedByHexproofQuality('blue', 'red', 'blue')).toBe(true);
      expect(isBlockedByHexproofQuality('blue', 'red', 'artifact')).toBe(false);
    });

    it('should summarize permanent and player targeting restrictions from hexproof', () => {
      expect(createHexproofTargetingResult(hexproof('sigarda', 'blue'), true, 'red', 'blue')).toEqual({
        source: 'sigarda',
        quality: 'blue',
        canTargetPermanent: false,
        canTargetPlayer: false,
        blockedByQuality: true,
      });
    });
  });

  describe('Indestructible (702.12)', () => {
    it('should distinguish surviving indestructible checks from ordinary destruction', () => {
      expect(survivesIndestructibleChecks(true, true, true)).toBe(true);
      expect(survivesIndestructibleChecks(false, false, true)).toBe(false);
      expect(survivesIndestructibleChecks(false, true, false)).toBe(false);
    });

    it('should summarize indestructible protection against destroy effects and lethal damage', () => {
      expect(createIndestructibleDestructionResult(indestructible('darksteel-myr'), true, true)).toEqual({
        source: 'darksteel-myr',
        destroyedByEffect: false,
        destroyedByDamage: false,
        survives: true,
      });
    });
  });
});