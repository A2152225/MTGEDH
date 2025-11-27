/**
 * Tests for tribal support module
 */
import { describe, it, expect } from 'vitest';
import {
  hasChangeling,
  getAllCreatureTypes,
  permanentQualifiesForTribal,
  countCreaturesOfType,
  findCreaturesOfType,
  detectCastTribalTriggers,
  detectETBTribalTriggers,
  detectTribalEffectInText,
  TribalTriggerType,
  COMMON_TRIBAL_EFFECTS,
} from '../src/tribalSupport';
import type { BattlefieldPermanent, KnownCardRef } from '../../shared/src';
import { CREATURE_TYPES } from '../../shared/src/creatureTypes';

// Helper to create a mock permanent
function createMockPermanent(
  id: string,
  controller: string,
  typeLine: string,
  oracleText: string = '',
  name: string = 'Test Card'
): BattlefieldPermanent {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: {
      name,
      type_line: typeLine,
      oracle_text: oracleText,
    } as KnownCardRef,
  } as BattlefieldPermanent;
}

describe('Tribal Support', () => {
  describe('hasChangeling', () => {
    it('should detect changeling keyword', () => {
      expect(hasChangeling('Changeling', '')).toBe(true);
      expect(hasChangeling('changeling', '')).toBe(true);
    });

    it('should detect changeling in type line', () => {
      expect(hasChangeling('', 'Creature — Shapeshifter Changeling')).toBe(true);
    });

    it('should detect "is every creature type" text', () => {
      expect(hasChangeling('This creature is every creature type.', '')).toBe(true);
    });

    it('should detect "all creature types" text', () => {
      expect(hasChangeling('Has all creature types.', '')).toBe(true);
    });

    it('should return false for non-changeling', () => {
      expect(hasChangeling('Flying, Haste', 'Creature — Dragon')).toBe(false);
    });
  });

  describe('getAllCreatureTypes', () => {
    it('should return all creature types for changeling', () => {
      const types = getAllCreatureTypes('Creature — Shapeshifter', 'Changeling');
      expect(types).toEqual(CREATURE_TYPES);
    });

    it('should return specific types for non-changeling', () => {
      const types = getAllCreatureTypes('Creature — Merfolk Wizard', '');
      expect(types).toContain('Merfolk');
      expect(types).toContain('Wizard');
      expect(types).not.toContain('Goblin');
    });

    it('should return empty array for non-creature', () => {
      const types = getAllCreatureTypes('Enchantment', '');
      expect(types).toHaveLength(0);
    });
  });

  describe('permanentQualifiesForTribal', () => {
    it('should match creature type', () => {
      const perm = createMockPermanent('1', 'p1', 'Creature — Merfolk Wizard');
      expect(permanentQualifiesForTribal(perm, 'Merfolk')).toBe(true);
      expect(permanentQualifiesForTribal(perm, 'Goblin')).toBe(false);
    });

    it('should match changeling to any type', () => {
      const perm = createMockPermanent('1', 'p1', 'Creature — Shapeshifter', 'Changeling');
      expect(permanentQualifiesForTribal(perm, 'Merfolk')).toBe(true);
      expect(permanentQualifiesForTribal(perm, 'Dragon')).toBe(true);
      expect(permanentQualifiesForTribal(perm, 'Goblin')).toBe(true);
    });
  });

  describe('countCreaturesOfType', () => {
    it('should count matching creatures', () => {
      const battlefield = [
        createMockPermanent('1', 'player1', 'Creature — Merfolk Wizard'),
        createMockPermanent('2', 'player1', 'Creature — Merfolk Rogue'),
        createMockPermanent('3', 'player1', 'Creature — Goblin'),
        createMockPermanent('4', 'player2', 'Creature — Merfolk'),
      ];

      expect(countCreaturesOfType(battlefield, 'player1', 'Merfolk')).toBe(2);
      expect(countCreaturesOfType(battlefield, 'player1', 'Goblin')).toBe(1);
      expect(countCreaturesOfType(battlefield, 'player2', 'Merfolk')).toBe(1);
    });

    it('should count changeling as all types', () => {
      const battlefield = [
        createMockPermanent('1', 'player1', 'Creature — Shapeshifter', 'Changeling'),
      ];

      expect(countCreaturesOfType(battlefield, 'player1', 'Merfolk')).toBe(1);
      expect(countCreaturesOfType(battlefield, 'player1', 'Dragon')).toBe(1);
    });
  });

  describe('findCreaturesOfType', () => {
    it('should find matching creatures', () => {
      const battlefield = [
        createMockPermanent('1', 'player1', 'Creature — Merfolk Wizard', '', 'Master of Waves'),
        createMockPermanent('2', 'player1', 'Creature — Goblin', '', 'Goblin Guide'),
      ];

      const merfolk = findCreaturesOfType(battlefield, 'player1', 'Merfolk');
      expect(merfolk).toHaveLength(1);
      expect((merfolk[0].card as KnownCardRef).name).toBe('Master of Waves');
    });
  });

  describe('detectCastTribalTriggers', () => {
    it('should detect "whenever you cast a Merfolk spell" trigger', () => {
      const battlefield = [
        createMockPermanent(
          '1', 
          'player1', 
          'Enchantment', 
          'Whenever you cast a Merfolk spell, create a 1/1 blue Merfolk creature token with hexproof.',
          'Deeproot Waters'
        ),
      ];

      const triggers = detectCastTribalTriggers(
        ['Creature'],
        '',
        'Creature — Merfolk Wizard',
        battlefield
      );

      expect(triggers.length).toBeGreaterThan(0);
      expect(triggers[0].effect.sourceName).toBe('Deeproot Waters');
      expect(triggers[0].effect.creatureType).toBe('Merfolk');
      expect(triggers[0].effect.triggerType).toBe(TribalTriggerType.CAST_CREATURE);
    });

    it('should not trigger for non-matching creature type', () => {
      const battlefield = [
        createMockPermanent(
          '1', 
          'player1', 
          'Enchantment', 
          'Whenever you cast a Merfolk spell, create a token.',
          'Deeproot Waters'
        ),
      ];

      const triggers = detectCastTribalTriggers(
        ['Creature'],
        '',
        'Creature — Goblin Warrior',
        battlefield
      );

      expect(triggers).toHaveLength(0);
    });

    it('should trigger for changeling casting any tribal spell', () => {
      const battlefield = [
        createMockPermanent(
          '1', 
          'player1', 
          'Enchantment', 
          'Whenever you cast a Dragon spell, draw a card.',
          'Dragon Tempest'
        ),
      ];

      // Changeling counts as a Dragon
      const triggers = detectCastTribalTriggers(
        ['Creature'],
        'Changeling',
        'Creature — Shapeshifter',
        battlefield
      );

      expect(triggers.length).toBeGreaterThan(0);
    });
  });

  describe('detectETBTribalTriggers', () => {
    it('should detect "whenever a Merfolk enters" trigger', () => {
      const enteringPerm = createMockPermanent(
        'entering',
        'player1',
        'Creature — Merfolk Wizard',
        '',
        'Silvergill Adept'
      );

      const battlefield = [
        createMockPermanent(
          'trigger-source',
          'player1',
          'Enchantment',
          'Whenever a Merfolk you control enters the battlefield, draw a card.',
          'Kindred Discovery'
        ),
        enteringPerm,
      ];

      const triggers = detectETBTribalTriggers(enteringPerm, battlefield);

      expect(triggers.length).toBeGreaterThan(0);
      expect(triggers[0].effect.sourceName).toBe('Kindred Discovery');
      expect(triggers[0].triggeredByPermanentName).toBe('Silvergill Adept');
    });

    it('should not trigger for opponent creature with "you control"', () => {
      const enteringPerm = createMockPermanent(
        'entering',
        'player2', // Different player
        'Creature — Merfolk',
        '',
        'Some Merfolk'
      );

      const battlefield = [
        createMockPermanent(
          'trigger-source',
          'player1',
          'Enchantment',
          'Whenever a Merfolk you control enters the battlefield, draw a card.',
          'Kindred Discovery'
        ),
        enteringPerm,
      ];

      const triggers = detectETBTribalTriggers(enteringPerm, battlefield);

      expect(triggers).toHaveLength(0);
    });
  });

  describe('detectTribalEffectInText', () => {
    it('should detect cast triggers', () => {
      const result = detectTribalEffectInText(
        'Whenever you cast a Merfolk spell, create a 1/1 token.'
      );

      expect(result.isTribal).toBe(true);
      expect(result.creatureTypes).toContain('Merfolk');
      expect(result.triggerType).toBe(TribalTriggerType.CAST_CREATURE);
    });

    it('should detect ETB triggers', () => {
      const result = detectTribalEffectInText(
        'Whenever a Goblin enters the battlefield under your control, draw a card.'
      );

      expect(result.isTribal).toBe(true);
      expect(result.creatureTypes).toContain('Goblin');
      expect(result.triggerType).toBe(TribalTriggerType.ENTERS_BATTLEFIELD);
    });

    it('should detect dies triggers', () => {
      const result = detectTribalEffectInText(
        'Whenever a Zombie you control dies, each opponent loses 1 life.'
      );

      expect(result.isTribal).toBe(true);
      expect(result.creatureTypes).toContain('Zombie');
      expect(result.triggerType).toBe(TribalTriggerType.DIES);
    });

    it('should return false for non-tribal text', () => {
      const result = detectTribalEffectInText('Draw a card.');

      expect(result.isTribal).toBe(false);
      expect(result.creatureTypes).toHaveLength(0);
    });
  });

  describe('COMMON_TRIBAL_EFFECTS', () => {
    it('should have Deeproot Waters', () => {
      expect(COMMON_TRIBAL_EFFECTS['Deeproot Waters']).toBeDefined();
      expect(COMMON_TRIBAL_EFFECTS['Deeproot Waters'].creatureType).toBe('Merfolk');
    });

    it('should have Kindred Discovery', () => {
      expect(COMMON_TRIBAL_EFFECTS['Kindred Discovery']).toBeDefined();
      expect(COMMON_TRIBAL_EFFECTS['Kindred Discovery'].creatureType).toBe('chosen');
    });

    it('should have Coat of Arms', () => {
      expect(COMMON_TRIBAL_EFFECTS['Coat of Arms']).toBeDefined();
      expect(COMMON_TRIBAL_EFFECTS['Coat of Arms'].creatureType).toBe('all');
    });
  });
});
