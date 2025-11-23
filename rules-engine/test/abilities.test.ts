/**
 * Tests for Rule 113: Abilities
 */
import { describe, it, expect } from 'vitest';
import {
  AbilityCategory,
  ActivatedAbility,
  TriggeredAbility,
  StaticAbility,
  TriggerEvent,
  StaticEffectType,
  isStackableAbility,
  isManaAbility,
  isLoyaltyAbility,
  ManaAbility,
  LoyaltyAbility
} from '../src/types/abilities';

describe('Rule 113: Abilities', () => {
  describe('Rule 113.3 - Four general categories', () => {
    it('should have all four ability categories', () => {
      expect(AbilityCategory.SPELL).toBe('spell');
      expect(AbilityCategory.ACTIVATED).toBe('activated');
      expect(AbilityCategory.TRIGGERED).toBe('triggered');
      expect(AbilityCategory.STATIC).toBe('static');
    });
  });

  describe('Rule 113.3b - Activated abilities', () => {
    it('should define activated ability with cost and effect', () => {
      const ability: ActivatedAbility = {
        category: AbilityCategory.ACTIVATED,
        id: 'test-activated-1',
        sourceId: 'card-1',
        cost: '{T}',
        effect: 'Add {G}',
        isManaAbility: true
      };

      expect(ability.category).toBe(AbilityCategory.ACTIVATED);
      expect(ability.cost).toBe('{T}');
      expect(ability.effect).toBe('Add {G}');
      expect(ability.isManaAbility).toBe(true);
    });

    it('should support activation restrictions', () => {
      const ability: ActivatedAbility = {
        category: AbilityCategory.ACTIVATED,
        id: 'test-activated-2',
        sourceId: 'card-2',
        cost: '{2}{R}',
        effect: 'Deal 3 damage to any target',
        activationRestrictions: [
          {
            type: 'timing',
            description: 'Activate only as a sorcery'
          }
        ]
      };

      expect(ability.activationRestrictions).toHaveLength(1);
      expect(ability.activationRestrictions![0].type).toBe('timing');
    });
  });

  describe('Rule 113.3c - Triggered abilities', () => {
    it('should define triggered ability with trigger and effect', () => {
      const ability: TriggeredAbility = {
        category: AbilityCategory.TRIGGERED,
        id: 'test-triggered-1',
        sourceId: 'card-3',
        trigger: {
          keyword: 'when',
          event: TriggerEvent.ENTERS_BATTLEFIELD
        },
        effect: 'Draw a card'
      };

      expect(ability.category).toBe(AbilityCategory.TRIGGERED);
      expect(ability.trigger.keyword).toBe('when');
      expect(ability.trigger.event).toBe(TriggerEvent.ENTERS_BATTLEFIELD);
    });

    it('should support various trigger events', () => {
      expect(TriggerEvent.ENTERS_BATTLEFIELD).toBe('enters_battlefield');
      expect(TriggerEvent.DIES).toBe('dies');
      expect(TriggerEvent.ATTACKS).toBe('attacks');
      expect(TriggerEvent.BEGINNING_OF_UPKEEP).toBe('beginning_of_upkeep');
    });

    it('should support trigger conditions', () => {
      const ability: TriggeredAbility = {
        category: AbilityCategory.TRIGGERED,
        id: 'test-triggered-2',
        sourceId: 'card-4',
        trigger: {
          keyword: 'whenever',
          event: TriggerEvent.DEALS_DAMAGE,
          condition: 'if this creature dealt damage to a player'
        },
        effect: 'Draw a card'
      };

      expect(ability.trigger.condition).toBeDefined();
    });
  });

  describe('Rule 113.3d - Static abilities', () => {
    it('should define static ability', () => {
      const ability: StaticAbility = {
        category: AbilityCategory.STATIC,
        id: 'test-static-1',
        sourceId: 'card-5',
        effect: 'Creatures you control get +1/+1',
        effectType: StaticEffectType.CONTINUOUS
      };

      expect(ability.category).toBe(AbilityCategory.STATIC);
      expect(ability.effectType).toBe('continuous');
    });

    it('should support characteristic-defining abilities', () => {
      const ability: StaticAbility = {
        category: AbilityCategory.STATIC,
        id: 'test-static-2',
        sourceId: 'card-6',
        effect: 'This creature\'s power and toughness are each equal to the number of cards in your hand',
        effectType: StaticEffectType.CHARACTERISTIC_DEFINING,
        isCharacteristicDefining: true
      };

      expect(ability.isCharacteristicDefining).toBe(true);
    });
  });

  describe('Rule 113.4 - Mana abilities', () => {
    it('should identify mana abilities', () => {
      const manaAbility: ManaAbility = {
        category: AbilityCategory.ACTIVATED,
        id: 'test-mana-1',
        sourceId: 'card-7',
        cost: '{T}',
        effect: 'Add {G}',
        isManaAbility: true,
        producedManaTypes: ['green']
      };

      expect(isManaAbility(manaAbility)).toBe(true);
    });

    it('should not identify non-mana abilities as mana abilities', () => {
      const regularAbility: ActivatedAbility = {
        category: AbilityCategory.ACTIVATED,
        id: 'test-regular-1',
        sourceId: 'card-8',
        cost: '{T}',
        effect: 'Draw a card'
      };

      expect(isManaAbility(regularAbility)).toBe(false);
    });
  });

  describe('Rule 113.5 - Loyalty abilities', () => {
    it('should identify loyalty abilities', () => {
      const loyaltyAbility: LoyaltyAbility = {
        category: AbilityCategory.ACTIVATED,
        id: 'test-loyalty-1',
        sourceId: 'planeswalker-1',
        cost: '+1',
        effect: 'Draw a card',
        isLoyaltyAbility: true,
        loyaltyCost: 1
      };

      expect(isLoyaltyAbility(loyaltyAbility)).toBe(true);
      expect(loyaltyAbility.loyaltyCost).toBe(1);
    });

    it('should support negative loyalty costs', () => {
      const ultimateAbility: LoyaltyAbility = {
        category: AbilityCategory.ACTIVATED,
        id: 'test-loyalty-2',
        sourceId: 'planeswalker-2',
        cost: '-7',
        effect: 'Win the game',
        isLoyaltyAbility: true,
        loyaltyCost: -7
      };

      expect(ultimateAbility.loyaltyCost).toBe(-7);
    });
  });

  describe('Ability type helpers', () => {
    it('should identify stackable abilities', () => {
      const activated: ActivatedAbility = {
        category: AbilityCategory.ACTIVATED,
        id: 'test-1',
        sourceId: 'card-1',
        cost: '{1}',
        effect: 'Test'
      };

      const triggered: TriggeredAbility = {
        category: AbilityCategory.TRIGGERED,
        id: 'test-2',
        sourceId: 'card-2',
        trigger: { keyword: 'when', event: TriggerEvent.DIES },
        effect: 'Test'
      };

      const static_: StaticAbility = {
        category: AbilityCategory.STATIC,
        id: 'test-3',
        sourceId: 'card-3',
        effect: 'Test',
        effectType: StaticEffectType.CONTINUOUS
      };

      expect(isStackableAbility(activated)).toBe(true);
      expect(isStackableAbility(triggered)).toBe(true);
      expect(isStackableAbility(static_)).toBe(false);
    });
  });
});
