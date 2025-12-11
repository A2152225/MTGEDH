/**
 * Tests for creatureUtils.ts
 * 
 * Tests the isCurrentlyCreature function for various card types including:
 * - Normal creatures
 * - Equipment with reconfigure (attached and unattached)
 * - Enchantments with bestow (attached and unattached)
 * - Non-creature permanents
 */

import { describe, it, expect } from 'vitest';
import { isCurrentlyCreature } from '../src/utils/creatureUtils';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';

// Helper to create a mock permanent
function createMockPermanent(
  typeLine: string,
  oracleText: string,
  attachedTo?: string
): BattlefieldPermanent {
  return {
    id: 'test-perm-1',
    controller: 'player1' as any,
    owner: 'player1' as any,
    attachedTo,
    card: {
      id: 'test-card-1',
      name: 'Test Card',
      type_line: typeLine,
      oracle_text: oracleText,
    } as KnownCardRef,
  };
}

describe('isCurrentlyCreature', () => {
  describe('Normal creatures', () => {
    it('should return true for basic creature', () => {
      const perm = createMockPermanent('Creature — Human', 'A basic creature');
      expect(isCurrentlyCreature(perm)).toBe(true);
    });

    it('should return true for artifact creature', () => {
      const perm = createMockPermanent('Artifact Creature — Golem', 'An artifact creature');
      expect(isCurrentlyCreature(perm)).toBe(true);
    });

    it('should return true for enchantment creature', () => {
      const perm = createMockPermanent('Enchantment Creature — God', 'An enchantment creature');
      expect(isCurrentlyCreature(perm)).toBe(true);
    });
  });

  describe('Equipment with Reconfigure', () => {
    it('should return true when reconfigure equipment is unattached', () => {
      const perm = createMockPermanent(
        'Artifact — Equipment',
        'Equipped creature gets +2/+2. Reconfigure {2}',
        undefined
      );
      expect(isCurrentlyCreature(perm)).toBe(true);
    });

    it('should return false when reconfigure equipment is attached', () => {
      const perm = createMockPermanent(
        'Artifact — Equipment',
        'Equipped creature gets +2/+2. Reconfigure {2}',
        'attached-to-creature-id'
      );
      expect(isCurrentlyCreature(perm)).toBe(false);
    });

    it('should not match false positives like "preconfigure"', () => {
      const perm = createMockPermanent(
        'Artifact',
        'You may preconfigure this artifact before the game begins.',
        undefined
      );
      expect(isCurrentlyCreature(perm)).toBe(false);
    });

    it('should handle case insensitive matching', () => {
      const perm = createMockPermanent(
        'Artifact — Equipment',
        'Equipped creature gets +2/+2. RECONFIGURE {2}',
        undefined
      );
      expect(isCurrentlyCreature(perm)).toBe(true);
    });
  });

  describe('Enchantments with Bestow', () => {
    it('should return true when bestow enchantment is unattached', () => {
      const perm = createMockPermanent(
        'Enchantment Creature — Cat',
        'Bestow {3}{W}. Enchanted creature gets +2/+2.',
        undefined
      );
      expect(isCurrentlyCreature(perm)).toBe(true);
    });

    it('should return false when bestow enchantment is attached', () => {
      const perm = createMockPermanent(
        'Enchantment Creature — Cat',
        'Bestow {3}{W}. Enchanted creature gets +2/+2.',
        'attached-to-creature-id'
      );
      expect(isCurrentlyCreature(perm)).toBe(false);
    });

    it('should not match false positives like "bestower"', () => {
      const perm = createMockPermanent(
        'Enchantment',
        'This card honors the great bestower of gifts.',
        undefined
      );
      expect(isCurrentlyCreature(perm)).toBe(false);
    });
  });

  describe('Non-creature permanents', () => {
    it('should return false for basic land', () => {
      const perm = createMockPermanent('Land', '{T}: Add {G}.');
      expect(isCurrentlyCreature(perm)).toBe(false);
    });

    it('should return false for basic artifact', () => {
      const perm = createMockPermanent('Artifact', '{T}: Draw a card.');
      expect(isCurrentlyCreature(perm)).toBe(false);
    });

    it('should return false for basic enchantment', () => {
      const perm = createMockPermanent('Enchantment', 'Creatures you control get +1/+1.');
      expect(isCurrentlyCreature(perm)).toBe(false);
    });

    it('should return false for planeswalker', () => {
      const perm = createMockPermanent('Planeswalker — Jace', '+1: Draw a card.');
      expect(isCurrentlyCreature(perm)).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should handle permanent with no card', () => {
      const perm: BattlefieldPermanent = {
        id: 'test-perm-1',
        controller: 'player1' as any,
        owner: 'player1' as any,
        card: undefined as any,
      };
      expect(isCurrentlyCreature(perm)).toBe(false);
    });

    it('should handle permanent with no oracle text', () => {
      const perm = createMockPermanent('Creature — Beast', '');
      expect(isCurrentlyCreature(perm)).toBe(true);
    });

    it('should handle permanent with undefined type_line', () => {
      const perm: BattlefieldPermanent = {
        id: 'test-perm-1',
        controller: 'player1' as any,
        owner: 'player1' as any,
        card: {
          id: 'test-card-1',
          name: 'Test Card',
          type_line: undefined as any,
          oracle_text: 'Some text',
        } as KnownCardRef,
      };
      expect(isCurrentlyCreature(perm)).toBe(false);
    });
  });

  describe('Real card examples', () => {
    it('should handle Simian Sling (reconfigure equipment)', () => {
      const unattached = createMockPermanent(
        'Artifact — Equipment',
        'Equipped creature gets +1/+1. Whenever equipped creature attacks, you may discard a card. If you do, draw a card. Reconfigure {2}',
        undefined
      );
      expect(isCurrentlyCreature(unattached)).toBe(true);

      const attached = createMockPermanent(
        'Artifact — Equipment',
        'Equipped creature gets +1/+1. Whenever equipped creature attacks, you may discard a card. If you do, draw a card. Reconfigure {2}',
        'some-creature'
      );
      expect(isCurrentlyCreature(attached)).toBe(false);
    });

    it('should handle Boon Satyr (bestow enchantment creature)', () => {
      const unattached = createMockPermanent(
        'Enchantment Creature — Satyr',
        'Flash. Bestow {3}{G}{G}. Enchanted creature gets +4/+2.',
        undefined
      );
      expect(isCurrentlyCreature(unattached)).toBe(true);

      const attached = createMockPermanent(
        'Enchantment Creature — Satyr',
        'Flash. Bestow {3}{G}{G}. Enchanted creature gets +4/+2.',
        'some-creature'
      );
      expect(isCurrentlyCreature(attached)).toBe(false);
    });
  });
});
