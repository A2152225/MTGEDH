/**
 * Tests for Rules 119-122: Player Actions
 */
import { describe, it, expect } from 'vitest';
import {
  GameVariantLife,
  LifeChange,
  canPayLife,
  setLifeTotal,
  hasLostDueToLife,
  DamageRecipient,
  DamageEvent,
  DamageResult,
  damageToPlayerCausesLifeLoss,
  damageWithInfectCausesPoisonCounters,
  damageToPlaneswalkerRemovesLoyalty,
  DrawCardEvent,
  drawCardsOneAtATime,
  canDrawCard,
  CounterType,
  cancelPlusMinusCounters,
  addCounter,
  removeCounter,
  getCounterCount
} from '../src/types/playerActions';

describe('Rule 119: Life', () => {
  describe('Rule 119.1 - Starting life totals', () => {
    it('should define standard starting life', () => {
      expect(GameVariantLife.STANDARD).toBe(20);
    });

    it('should define variant starting life totals', () => {
      expect(GameVariantLife.TWO_HEADED_GIANT).toBe(30);
      expect(GameVariantLife.COMMANDER).toBe(40);
      expect(GameVariantLife.BRAWL_MULTIPLAYER).toBe(30);
      expect(GameVariantLife.BRAWL_TWO_PLAYER).toBe(25);
      expect(GameVariantLife.ARCHENEMY).toBe(40);
    });
  });

  describe('Rule 119.4 - Paying life', () => {
    it('should allow paying life when sufficient', () => {
      expect(canPayLife(20, 5)).toBe(true);
      expect(canPayLife(10, 10)).toBe(true);
      expect(canPayLife(1, 1)).toBe(true);
    });

    it('should not allow paying more life than available', () => {
      expect(canPayLife(5, 10)).toBe(false);
      expect(canPayLife(0, 1)).toBe(false);
    });

    it('should always allow paying 0 life', () => {
      expect(canPayLife(20, 0)).toBe(true);
      expect(canPayLife(0, 0)).toBe(true);
      expect(canPayLife(-5, 0)).toBe(true);
    });
  });

  describe('Rule 119.5 - Set life total', () => {
    it('should calculate correct life change for gain', () => {
      const change = setLifeTotal(20, 30);
      expect(change.amount).toBe(10);
      expect(change.isDamage).toBe(false);
    });

    it('should calculate correct life change for loss', () => {
      const change = setLifeTotal(20, 5);
      expect(change.amount).toBe(-15);
    });
  });

  describe('Rule 119.6 - Losing due to life total', () => {
    it('should identify when player has lost', () => {
      expect(hasLostDueToLife(0)).toBe(true);
      expect(hasLostDueToLife(-1)).toBe(true);
      expect(hasLostDueToLife(-10)).toBe(true);
    });

    it('should identify when player has not lost', () => {
      expect(hasLostDueToLife(1)).toBe(false);
      expect(hasLostDueToLife(20)).toBe(false);
    });
  });
});

describe('Rule 120: Damage', () => {
  describe('Rule 120.1 - Damage recipients', () => {
    it('should define all damage recipient types', () => {
      expect(DamageRecipient.PLAYER).toBe('player');
      expect(DamageRecipient.CREATURE).toBe('creature');
      expect(DamageRecipient.PLANESWALKER).toBe('planeswalker');
      expect(DamageRecipient.BATTLE).toBe('battle');
    });
  });

  describe('Rule 120.3a - Damage to player causes life loss', () => {
    it('should cause life loss for normal damage', () => {
      const damage: DamageEvent = {
        source: 'lightning-bolt',
        recipientId: 'player-1',
        recipientType: DamageRecipient.PLAYER,
        amount: 3,
        isCombatDamage: false,
        characteristics: {
          hasInfect: false,
          hasWither: false,
          hasLifelink: false,
          hasDeathtouch: false,
          hasDoubleStrike: false,
          hasFirstStrike: false,
          hasTrample: false
        }
      };

      expect(damageToPlayerCausesLifeLoss(damage, false)).toBe(true);
    });

    it('should not cause life loss for damage with infect', () => {
      const damage: DamageEvent = {
        source: 'infect-creature',
        recipientId: 'player-1',
        recipientType: DamageRecipient.PLAYER,
        amount: 2,
        isCombatDamage: true,
        characteristics: {
          hasInfect: true,
          hasWither: false,
          hasLifelink: false,
          hasDeathtouch: false,
          hasDoubleStrike: false,
          hasFirstStrike: false,
          hasTrample: false
        }
      };

      expect(damageToPlayerCausesLifeLoss(damage, true)).toBe(false);
    });
  });

  describe('Rule 120.3b - Damage with infect causes poison counters', () => {
    it('should identify infect damage to player', () => {
      const damage: DamageEvent = {
        source: 'infect-creature',
        recipientId: 'player-1',
        recipientType: DamageRecipient.PLAYER,
        amount: 2,
        isCombatDamage: true,
        characteristics: {
          hasInfect: true,
          hasWither: false,
          hasLifelink: false,
          hasDeathtouch: false,
          hasDoubleStrike: false,
          hasFirstStrike: false,
          hasTrample: false
        }
      };

      expect(damageWithInfectCausesPoisonCounters(damage)).toBe(true);
    });
  });

  describe('Rule 120.3c - Damage to planeswalker removes loyalty', () => {
    it('should identify damage to planeswalker', () => {
      const damage: DamageEvent = {
        source: 'lightning-bolt',
        recipientId: 'jace-1',
        recipientType: DamageRecipient.PLANESWALKER,
        amount: 3,
        isCombatDamage: false,
        characteristics: {
          hasInfect: false,
          hasWither: false,
          hasLifelink: false,
          hasDeathtouch: false,
          hasDoubleStrike: false,
          hasFirstStrike: false,
          hasTrample: false
        }
      };

      expect(damageToPlaneswalkerRemovesLoyalty(damage)).toBe(true);
    });
  });
});

describe('Rule 121: Drawing a Card', () => {
  describe('Rule 121.2 - Cards drawn one at a time', () => {
    it('should create individual draw events', () => {
      const events = drawCardsOneAtATime(3);
      expect(events).toHaveLength(3);
      events.forEach(event => {
        expect(event.count).toBe(1);
      });
    });

    it('should handle single card draw', () => {
      const events = drawCardsOneAtATime(1);
      expect(events).toHaveLength(1);
    });
  });

  describe('Rule 121.3 - Can\'t draw from empty library', () => {
    it('should allow drawing when library has cards', () => {
      expect(canDrawCard(10)).toBe(true);
      expect(canDrawCard(1)).toBe(true);
    });

    it('should not allow drawing from empty library', () => {
      expect(canDrawCard(0)).toBe(false);
    });
  });
});

describe('Rule 122: Counters', () => {
  describe('Rule 122.1 - Counter types', () => {
    it('should define common counter types', () => {
      expect(CounterType.PLUS_ONE_PLUS_ONE).toBe('+1/+1');
      expect(CounterType.MINUS_ONE_MINUS_ONE).toBe('-1/-1');
      expect(CounterType.POISON).toBe('poison');
      expect(CounterType.ENERGY).toBe('energy');
      expect(CounterType.LOYALTY).toBe('loyalty');
    });
  });

  describe('Rule 122.3 - +1/+1 and -1/-1 counters cancel', () => {
    it('should cancel equal amounts', () => {
      const result = cancelPlusMinusCounters(3, 3);
      expect(result.plusOne).toBe(0);
      expect(result.minusOne).toBe(0);
    });

    it('should leave excess +1/+1 counters', () => {
      const result = cancelPlusMinusCounters(5, 2);
      expect(result.plusOne).toBe(3);
      expect(result.minusOne).toBe(0);
    });

    it('should leave excess -1/-1 counters', () => {
      const result = cancelPlusMinusCounters(1, 4);
      expect(result.plusOne).toBe(0);
      expect(result.minusOne).toBe(3);
    });
  });

  describe('Counter operations', () => {
    it('should add counters', () => {
      const counters = new Map<string, number>();
      const updated = addCounter(counters, '+1/+1', 2);
      
      expect(updated.get('+1/+1')).toBe(2);
    });

    it('should add to existing counters', () => {
      const counters = new Map<string, number>();
      counters.set('+1/+1', 3);
      
      const updated = addCounter(counters, '+1/+1', 2);
      expect(updated.get('+1/+1')).toBe(5);
    });

    it('should remove counters', () => {
      const counters = new Map<string, number>();
      counters.set('+1/+1', 5);
      
      const updated = removeCounter(counters, '+1/+1', 2);
      expect(updated?.get('+1/+1')).toBe(3);
    });

    it('should remove all counters when amount equals count', () => {
      const counters = new Map<string, number>();
      counters.set('+1/+1', 3);
      
      const updated = removeCounter(counters, '+1/+1', 3);
      expect(updated?.has('+1/+1')).toBe(false);
    });

    it('should return null when removing more than available', () => {
      const counters = new Map<string, number>();
      counters.set('+1/+1', 2);
      
      const updated = removeCounter(counters, '+1/+1', 5);
      expect(updated).toBeNull();
    });

    it('should get counter count', () => {
      const counters = new Map<string, number>();
      counters.set('poison', 3);
      counters.set('energy', 5);
      
      expect(getCounterCount(counters, 'poison')).toBe(3);
      expect(getCounterCount(counters, 'energy')).toBe(5);
      expect(getCounterCount(counters, 'charge')).toBe(0);
    });
  });

  describe('Counter examples from real cards', () => {
    it('should handle Tarmogoyf-style +1/+1 counters', () => {
      let counters = new Map<string, number>();
      counters = addCounter(counters, '+1/+1', 1);
      counters = addCounter(counters, '+1/+1', 1);
      
      expect(getCounterCount(counters, '+1/+1')).toBe(2);
    });

    it('should handle poison counters on player', () => {
      let counters = new Map<string, number>();
      counters = addCounter(counters, 'poison', 3);
      counters = addCounter(counters, 'poison', 2);
      
      expect(getCounterCount(counters, 'poison')).toBe(5);
    });

    it('should handle planeswalker loyalty counters', () => {
      let counters = new Map<string, number>();
      counters = addCounter(counters, 'loyalty', 3);  // Starting loyalty
      counters = addCounter(counters, 'loyalty', 1);  // +1 ability
      const afterMinus = removeCounter(counters, 'loyalty', 2);  // -2 ability
      
      expect(getCounterCount(afterMinus!, 'loyalty')).toBe(2);
    });
  });
});
