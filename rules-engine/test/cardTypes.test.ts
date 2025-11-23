/**
 * Tests for Section 3: Card Types (Rules 300-315)
 */

import { describe, it, expect } from 'vitest';
import {
  // Rule 300
  isMultiType,
  canOnlyBePlayedAsLand,
  // Rule 301: Artifacts
  getArtifactCastingRules,
  // Rule 302: Creatures
  getCreatureCastingRules,
  hasSummoningSickness,
  canAttack,
  canActivateTapAbility,
  // Rule 303: Enchantments
  getEnchantmentCastingRules,
  requiresTarget,
  // Rule 304: Instants
  getInstantCastingRules,
  canEnterBattlefield,
  // Rule 305: Lands
  getLandPlayRules,
  canPlayLand,
  // Rule 306: Planeswalkers
  getPlaneswalkerCastingRules,
  // Rule 307: Sorceries
  getSorceryCastingRules,
  canDoAsSorcery,
  // Rule 310: Battles
  getBattleCastingRules,
  getCurrentDefense,
  applyDamageToBattle,
  shouldBattleDie,
  canBeProtector,
  BattleType,
  // Rules 311-315: Nontraditional cards
  getPlanesRules,
  getPhenomenaRules,
  getVanguardRules,
  getSchemeRules,
  getConspiracyRules,
} from '../src/types/cardTypes';
import { CardType } from '../src/types/objects';
import { isBasicLandType, LandType } from '../src/types/cardParts';

describe('Section 3: Card Types', () => {
  describe('Rule 300: General', () => {
    it('should identify multi-type objects (Rule 300.2)', () => {
      expect(isMultiType([CardType.ARTIFACT, CardType.CREATURE])).toBe(true);
      expect(isMultiType([CardType.CREATURE])).toBe(false);
      expect(isMultiType([CardType.ENCHANTMENT, CardType.CREATURE])).toBe(true);
    });

    it('should identify land+other combinations that can only be played as land (Rule 300.2a)', () => {
      expect(canOnlyBePlayedAsLand([CardType.ARTIFACT, CardType.LAND])).toBe(true);
      expect(canOnlyBePlayedAsLand([CardType.LAND])).toBe(false);
      expect(canOnlyBePlayedAsLand([CardType.ARTIFACT, CardType.CREATURE])).toBe(false);
    });
  });

  describe('Rule 301: Artifacts', () => {
    it('should return artifact casting rules (Rule 301.1)', () => {
      const rules = getArtifactCastingRules();
      expect(rules.canCastDuringMainPhase).toBe(true);
      expect(rules.requiresStackEmpty).toBe(false);
    });
  });

  describe('Rule 302: Creatures', () => {
    it('should return creature casting rules (Rule 302.1)', () => {
      const rules = getCreatureCastingRules();
      expect(rules.canCastDuringMainPhase).toBe(true);
      expect(rules.requiresStackEmpty).toBe(false);
      expect(rules.hasPowerAndToughness).toBe(true);
    });

    it('should check summoning sickness (Rule 302.6)', () => {
      const sicknessState = {
        objectId: 'creature1',
        controller: 'player1',
        controlledSinceTurnStart: false
      };
      expect(hasSummoningSickness(sicknessState)).toBe(true);
      expect(canAttack(sicknessState)).toBe(false);
      expect(canActivateTapAbility(sicknessState)).toBe(false);
    });

    it('should allow actions when no summoning sickness (Rule 302.6)', () => {
      const readyState = {
        objectId: 'creature1',
        controller: 'player1',
        controlledSinceTurnStart: true
      };
      expect(hasSummoningSickness(readyState)).toBe(false);
      expect(canAttack(readyState)).toBe(true);
      expect(canActivateTapAbility(readyState)).toBe(true);
    });
  });

  describe('Rule 303: Enchantments', () => {
    it('should return enchantment casting rules (Rule 303.1)', () => {
      const rules = getEnchantmentCastingRules();
      expect(rules.canCastDuringMainPhase).toBe(true);
      expect(rules.requiresStackEmpty).toBe(false);
    });

    it('should identify Auras as requiring targets (Rule 303.4a)', () => {
      expect(requiresTarget(['Aura'])).toBe(true);
      expect(requiresTarget(['Saga'])).toBe(false);
      expect(requiresTarget(['Aura', 'Curse'])).toBe(true);
    });
  });

  describe('Rule 304: Instants', () => {
    it('should return instant casting rules (Rule 304.1)', () => {
      const rules = getInstantCastingRules();
      expect(rules.canCastAnytime).toBe(true);
      expect(rules.requiresMainPhase).toBe(false);
      expect(rules.requiresStackEmpty).toBe(false);
    });

    it('should prevent instants from entering battlefield (Rule 304.4)', () => {
      expect(canEnterBattlefield(CardType.INSTANT)).toBe(false);
      expect(canEnterBattlefield(CardType.SORCERY)).toBe(false);
      expect(canEnterBattlefield(CardType.CREATURE)).toBe(true);
      expect(canEnterBattlefield(CardType.ARTIFACT)).toBe(true);
    });
  });

  describe('Rule 305: Lands', () => {
    it('should return land play rules (Rule 305.1)', () => {
      const rules = getLandPlayRules();
      expect(rules.isSpecialAction).toBe(true);
      expect(rules.requiresMainPhase).toBe(true);
      expect(rules.requiresStackEmpty).toBe(true);
      expect(rules.requiresOwnTurn).toBe(true);
      expect(rules.usesStack).toBe(false);
    });

    it('should enforce land play limit (Rule 305.2)', () => {
      expect(canPlayLand({ landsPlayedThisTurn: 0, maxLandsPerTurn: 1 })).toBe(true);
      expect(canPlayLand({ landsPlayedThisTurn: 1, maxLandsPerTurn: 1 })).toBe(false);
      expect(canPlayLand({ landsPlayedThisTurn: 0, maxLandsPerTurn: 2 })).toBe(true);
      expect(canPlayLand({ landsPlayedThisTurn: 1, maxLandsPerTurn: 2 })).toBe(true);
      expect(canPlayLand({ landsPlayedThisTurn: 2, maxLandsPerTurn: 2 })).toBe(false);
    });

    it('should identify basic land types (Rule 305.6)', () => {
      expect(isBasicLandType(LandType.PLAINS)).toBe(true);
      expect(isBasicLandType(LandType.ISLAND)).toBe(true);
      expect(isBasicLandType(LandType.SWAMP)).toBe(true);
      expect(isBasicLandType(LandType.MOUNTAIN)).toBe(true);
      expect(isBasicLandType(LandType.FOREST)).toBe(true);
      expect(isBasicLandType(LandType.DESERT)).toBe(false);
      expect(isBasicLandType(LandType.LAIR)).toBe(false);
    });
  });

  describe('Rule 306: Planeswalkers', () => {
    it('should return planeswalker casting rules (Rule 306.1)', () => {
      const rules = getPlaneswalkerCastingRules();
      expect(rules.canCastDuringMainPhase).toBe(true);
      expect(rules.requiresStackEmpty).toBe(false);
      expect(rules.hasLoyalty).toBe(true);
    });
  });

  describe('Rule 307: Sorceries', () => {
    it('should return sorcery casting rules (Rule 307.1)', () => {
      const rules = getSorceryCastingRules();
      expect(rules.canCastDuringMainPhase).toBe(true);
      expect(rules.requiresStackEmpty).toBe(true);
      expect(rules.requiresOwnTurn).toBe(true);
    });

    it('should check sorcery timing (Rule 307.5)', () => {
      expect(canDoAsSorcery({
        hasPriority: true,
        isMainPhase: true,
        isOwnTurn: true,
        isStackEmpty: true
      })).toBe(true);

      expect(canDoAsSorcery({
        hasPriority: false,
        isMainPhase: true,
        isOwnTurn: true,
        isStackEmpty: true
      })).toBe(false);

      expect(canDoAsSorcery({
        hasPriority: true,
        isMainPhase: false,
        isOwnTurn: true,
        isStackEmpty: true
      })).toBe(false);

      expect(canDoAsSorcery({
        hasPriority: true,
        isMainPhase: true,
        isOwnTurn: false,
        isStackEmpty: true
      })).toBe(false);

      expect(canDoAsSorcery({
        hasPriority: true,
        isMainPhase: true,
        isOwnTurn: true,
        isStackEmpty: false
      })).toBe(false);
    });
  });

  describe('Rule 310: Battles', () => {
    it('should return battle casting rules (Rule 310.1)', () => {
      const rules = getBattleCastingRules();
      expect(rules.canCastDuringMainPhase).toBe(true);
      expect(rules.requiresStackEmpty).toBe(false);
      expect(rules.hasDefense).toBe(true);
    });

    it('should track battle defense (Rule 310.4)', () => {
      const battle = { printedDefense: 5, defenseCounters: 5 };
      expect(getCurrentDefense(battle)).toBe(5);
    });

    it('should apply damage to battles (Rule 310.6)', () => {
      const battle = { printedDefense: 5, defenseCounters: 5 };
      const damaged = applyDamageToBattle(battle, 3);
      expect(getCurrentDefense(damaged)).toBe(2);
    });

    it('should not reduce defense below zero', () => {
      const battle = { printedDefense: 5, defenseCounters: 2 };
      const destroyed = applyDamageToBattle(battle, 5);
      expect(getCurrentDefense(destroyed)).toBe(0);
    });

    it('should check if battle should die (Rule 310.7)', () => {
      expect(shouldBattleDie({ printedDefense: 5, defenseCounters: 0 })).toBe(true);
      expect(shouldBattleDie({ printedDefense: 5, defenseCounters: 1 })).toBe(false);
    });

    it('should validate siege protector (Rule 310.11a)', () => {
      const opponents = ['player2', 'player3'];
      expect(canBeProtector('player1', 'player2', opponents)).toBe(true);
      expect(canBeProtector('player1', 'player3', opponents)).toBe(true);
      expect(canBeProtector('player1', 'player1', opponents)).toBe(false);
      expect(canBeProtector('player1', 'player4', opponents)).toBe(false);
    });
  });

  describe('Rules 311-315: Nontraditional Cards', () => {
    it('should define plane rules (Rule 311)', () => {
      const rules = getPlanesRules();
      expect(rules.isNontraditional).toBe(true);
      expect(rules.canBeCast).toBe(false);
      expect(rules.startsInCommandZone).toBe(true);
    });

    it('should define phenomena rules (Rule 312)', () => {
      const rules = getPhenomenaRules();
      expect(rules.isNontraditional).toBe(true);
      expect(rules.canBeCast).toBe(false);
      expect(rules.startsInCommandZone).toBe(true);
    });

    it('should define vanguard rules (Rule 313)', () => {
      const rules = getVanguardRules();
      expect(rules.isNontraditional).toBe(true);
      expect(rules.canBeCast).toBe(false);
      expect(rules.startsInCommandZone).toBe(true);
    });

    it('should define scheme rules (Rule 314)', () => {
      const rules = getSchemeRules();
      expect(rules.isNontraditional).toBe(true);
      expect(rules.canBeCast).toBe(false);
      expect(rules.startsInCommandZone).toBe(true);
    });

    it('should define conspiracy rules (Rule 315)', () => {
      const rules = getConspiracyRules();
      expect(rules.isNontraditional).toBe(true);
      expect(rules.canBeCast).toBe(false);
      expect(rules.startsInCommandZone).toBe(true);
    });
  });
});
