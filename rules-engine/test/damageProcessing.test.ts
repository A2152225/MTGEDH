/**
 * Tests for damage processing module
 */
import { describe, it, expect } from 'vitest';
import {
  parseDamageAbilities,
  processDamageToPlayer,
  processDamageToCreature,
  processDamageToPlaneswalker,
  processDamageToBattle,
  processDamage,
  wouldCreatureDieFromMinusCounters,
  calculateEffectiveToughness,
  DamageRecipientType,
} from '../src/damageProcessing';
import type { DamageEvent, DamageSourceCharacteristics } from '../src/damageProcessing';

describe('Damage Processing', () => {
  describe('parseDamageAbilities', () => {
    it('should detect infect', () => {
      const abilities = parseDamageAbilities('Infect', '');
      expect(abilities.hasInfect).toBe(true);
    });

    it('should detect wither', () => {
      const abilities = parseDamageAbilities('Wither', '');
      expect(abilities.hasWither).toBe(true);
    });

    it('should detect toxic with value', () => {
      const abilities = parseDamageAbilities('Toxic 3', '');
      expect(abilities.hasToxic).toBe(true);
      expect(abilities.toxicValue).toBe(3);
    });

    it('should detect poisonous with value', () => {
      const abilities = parseDamageAbilities('Poisonous 1', '');
      expect(abilities.hasPoisonous).toBe(true);
      expect(abilities.poisonousValue).toBe(1);
    });

    it('should detect lifelink', () => {
      const abilities = parseDamageAbilities('Lifelink', '');
      expect(abilities.hasLifelink).toBe(true);
    });

    it('should detect deathtouch', () => {
      const abilities = parseDamageAbilities('Deathtouch', '');
      expect(abilities.hasDeathtouch).toBe(true);
    });

    it('should detect multiple abilities', () => {
      const abilities = parseDamageAbilities('Infect, Deathtouch', '');
      expect(abilities.hasInfect).toBe(true);
      expect(abilities.hasDeathtouch).toBe(true);
    });
  });

  describe('processDamageToPlayer', () => {
    const createDamageEvent = (
      amount: number,
      characteristics: Partial<DamageSourceCharacteristics>,
      isCombatDamage = false
    ): DamageEvent => ({
      sourceId: 'source-1',
      sourceName: 'Test Source',
      sourceControllerId: 'player1',
      recipientId: 'player2',
      recipientType: DamageRecipientType.PLAYER,
      amount,
      isCombatDamage,
      characteristics: {
        hasInfect: false,
        hasWither: false,
        hasToxic: false,
        toxicValue: 0,
        hasPoisonous: false,
        poisonousValue: 0,
        hasLifelink: false,
        hasDeathtouch: false,
        sourceId: 'source-1',
        sourceName: 'Test Source',
        controllerId: 'player1',
        ...characteristics,
      },
    });

    it('should cause life loss for normal damage', () => {
      const damage = createDamageEvent(5, {});
      const result = processDamageToPlayer(damage);
      
      expect(result.lifeChange).toBe(-5);
      expect(result.poisonCounters).toBe(0);
    });

    it('should give poison counters for infect damage', () => {
      const damage = createDamageEvent(4, { hasInfect: true });
      const result = processDamageToPlayer(damage);
      
      expect(result.lifeChange).toBe(0);
      expect(result.poisonCounters).toBe(4);
    });

    it('should give poison counters AND life loss for toxic (combat damage)', () => {
      const damage = createDamageEvent(3, { hasToxic: true, toxicValue: 2 }, true);
      const result = processDamageToPlayer(damage);
      
      expect(result.lifeChange).toBe(-3);
      expect(result.poisonCounters).toBe(2);
    });

    it('should not apply toxic on non-combat damage', () => {
      const damage = createDamageEvent(3, { hasToxic: true, toxicValue: 2 }, false);
      const result = processDamageToPlayer(damage);
      
      expect(result.lifeChange).toBe(-3);
      expect(result.poisonCounters).toBe(0);
    });

    it('should trigger poisonous on combat damage', () => {
      const damage = createDamageEvent(1, { hasPoisonous: true, poisonousValue: 3 }, true);
      const result = processDamageToPlayer(damage);
      
      expect(result.lifeChange).toBe(-1);
      expect(result.poisonCounters).toBe(3);
    });

    it('should provide lifelink healing', () => {
      const damage = createDamageEvent(5, { hasLifelink: true });
      const result = processDamageToPlayer(damage);
      
      expect(result.lifelinkHealing).toBe(5);
    });
  });

  describe('processDamageToCreature', () => {
    const createDamageEvent = (
      amount: number,
      characteristics: Partial<DamageSourceCharacteristics>,
      isCombatDamage = false
    ): DamageEvent => ({
      sourceId: 'source-1',
      sourceName: 'Test Source',
      sourceControllerId: 'player1',
      recipientId: 'creature-1',
      recipientType: DamageRecipientType.CREATURE,
      amount,
      isCombatDamage,
      characteristics: {
        hasInfect: false,
        hasWither: false,
        hasToxic: false,
        toxicValue: 0,
        hasPoisonous: false,
        poisonousValue: 0,
        hasLifelink: false,
        hasDeathtouch: false,
        sourceId: 'source-1',
        sourceName: 'Test Source',
        controllerId: 'player1',
        ...characteristics,
      },
    });

    it('should mark normal damage', () => {
      const damage = createDamageEvent(3, {});
      const result = processDamageToCreature(damage, 4);
      
      expect(result.markedDamage).toBe(3);
      expect(result.minusCounters).toBe(0);
    });

    it('should give -1/-1 counters for infect damage', () => {
      const damage = createDamageEvent(4, { hasInfect: true });
      const result = processDamageToCreature(damage, 4);
      
      expect(result.minusCounters).toBe(4);
      expect(result.markedDamage).toBe(0);
    });

    it('should give -1/-1 counters for wither damage', () => {
      const damage = createDamageEvent(3, { hasWither: true });
      const result = processDamageToCreature(damage, 5);
      
      expect(result.minusCounters).toBe(3);
      expect(result.markedDamage).toBe(0);
    });

    it('should set deathtouch flag', () => {
      const damage = createDamageEvent(1, { hasDeathtouch: true });
      const result = processDamageToCreature(damage, 5);
      
      expect(result.deathtouch).toBe(true);
    });

    it('should provide lifelink healing', () => {
      const damage = createDamageEvent(4, { hasLifelink: true });
      const result = processDamageToCreature(damage, 5);
      
      expect(result.lifelinkHealing).toBe(4);
    });
  });

  describe('processDamageToPlaneswalker', () => {
    const createDamageEvent = (amount: number): DamageEvent => ({
      sourceId: 'source-1',
      sourceName: 'Test Source',
      sourceControllerId: 'player1',
      recipientId: 'pw-1',
      recipientType: DamageRecipientType.PLANESWALKER,
      amount,
      isCombatDamage: true,
      characteristics: {
        hasInfect: false,
        hasWither: false,
        hasToxic: false,
        toxicValue: 0,
        hasPoisonous: false,
        poisonousValue: 0,
        hasLifelink: false,
        hasDeathtouch: false,
        sourceId: 'source-1',
        sourceName: 'Test Source',
        controllerId: 'player1',
      },
    });

    it('should remove loyalty counters', () => {
      const damage = createDamageEvent(5);
      const result = processDamageToPlaneswalker(damage);
      
      expect(result.loyaltyLoss).toBe(5);
      expect(result.lifeChange).toBe(0);
    });
  });

  describe('processDamageToBattle', () => {
    const createDamageEvent = (amount: number): DamageEvent => ({
      sourceId: 'source-1',
      sourceName: 'Test Source',
      sourceControllerId: 'player1',
      recipientId: 'battle-1',
      recipientType: DamageRecipientType.BATTLE,
      amount,
      isCombatDamage: true,
      characteristics: {
        hasInfect: false,
        hasWither: false,
        hasToxic: false,
        toxicValue: 0,
        hasPoisonous: false,
        poisonousValue: 0,
        hasLifelink: false,
        hasDeathtouch: false,
        sourceId: 'source-1',
        sourceName: 'Test Source',
        controllerId: 'player1',
      },
    });

    it('should remove defense counters', () => {
      const damage = createDamageEvent(4);
      const result = processDamageToBattle(damage);
      
      expect(result.defenseCounterLoss).toBe(4);
    });
  });

  describe('processDamage', () => {
    it('should dispatch to correct handler based on recipient type', () => {
      const playerDamage: DamageEvent = {
        sourceId: 'source-1',
        sourceName: 'Test',
        sourceControllerId: 'player1',
        recipientId: 'player2',
        recipientType: DamageRecipientType.PLAYER,
        amount: 3,
        isCombatDamage: false,
        characteristics: {
          hasInfect: false,
          hasWither: false,
          hasToxic: false,
          toxicValue: 0,
          hasPoisonous: false,
          poisonousValue: 0,
          hasLifelink: false,
          hasDeathtouch: false,
          sourceId: 'source-1',
          sourceName: 'Test',
          controllerId: 'player1',
        },
      };

      const result = processDamage(playerDamage);
      
      expect(result.lifeChange).toBe(-3);
    });
  });

  describe('wouldCreatureDieFromMinusCounters', () => {
    it('should return true when toughness would reach 0', () => {
      expect(wouldCreatureDieFromMinusCounters(3, 0, 3)).toBe(true);
      expect(wouldCreatureDieFromMinusCounters(3, 1, 2)).toBe(true);
    });

    it('should return false when toughness would remain positive', () => {
      expect(wouldCreatureDieFromMinusCounters(4, 0, 3)).toBe(false);
      expect(wouldCreatureDieFromMinusCounters(5, 2, 2)).toBe(false);
    });

    it('should consider existing counters', () => {
      expect(wouldCreatureDieFromMinusCounters(4, 2, 2)).toBe(true); // 4 - 2 - 2 = 0
    });

    it('should consider modifiers', () => {
      // Base 3, modifier +2, 0 existing, 4 new = 3 + 2 - 0 - 4 = 1 (lives)
      expect(wouldCreatureDieFromMinusCounters(3, 0, 4, 2)).toBe(false);
      // Base 3, modifier +2, 0 existing, 5 new = 3 + 2 - 0 - 5 = 0 (dies)
      expect(wouldCreatureDieFromMinusCounters(3, 0, 5, 2)).toBe(true);
    });
  });

  describe('calculateEffectiveToughness', () => {
    it('should calculate base toughness minus counters', () => {
      expect(calculateEffectiveToughness(4, 2)).toBe(2);
    });

    it('should add plus counters', () => {
      expect(calculateEffectiveToughness(3, 1, 2)).toBe(4); // 3 - 1 + 2 = 4
    });

    it('should add modifiers', () => {
      expect(calculateEffectiveToughness(3, 1, 0, 2)).toBe(4); // 3 - 1 + 0 + 2 = 4
    });

    it('should combine all factors', () => {
      // Base 4, minus 2, plus 1, modifier +3 = 4 - 2 + 1 + 3 = 6
      expect(calculateEffectiveToughness(4, 2, 1, 3)).toBe(6);
    });
  });
});
