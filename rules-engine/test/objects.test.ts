/**
 * Tests for Rules 108-110: Cards, Objects, and Permanents
 */
import { describe, it, expect } from 'vitest';
import {
  CardType,
  PERMANENT_CARD_TYPES,
  isPermanentType,
  Zone,
  createDefaultPermanentStatus
} from '../src/types/objects';

describe('Rules 108-110: Cards, Objects, and Permanents', () => {
  describe('Rule 110.4 - Six permanent types', () => {
    it('should have exactly six permanent types', () => {
      expect(PERMANENT_CARD_TYPES).toHaveLength(6);
      expect(PERMANENT_CARD_TYPES).toContain(CardType.ARTIFACT);
      expect(PERMANENT_CARD_TYPES).toContain(CardType.BATTLE);
      expect(PERMANENT_CARD_TYPES).toContain(CardType.CREATURE);
      expect(PERMANENT_CARD_TYPES).toContain(CardType.ENCHANTMENT);
      expect(PERMANENT_CARD_TYPES).toContain(CardType.LAND);
      expect(PERMANENT_CARD_TYPES).toContain(CardType.PLANESWALKER);
    });

    it('should identify permanent types correctly', () => {
      expect(isPermanentType(CardType.CREATURE)).toBe(true);
      expect(isPermanentType(CardType.ARTIFACT)).toBe(true);
      expect(isPermanentType(CardType.LAND)).toBe(true);
      expect(isPermanentType(CardType.INSTANT)).toBe(false);
      expect(isPermanentType(CardType.SORCERY)).toBe(false);
    });
  });

  describe('Rule 110.5 - Permanent status', () => {
    it('should create default status with all false values', () => {
      const status = createDefaultPermanentStatus();
      expect(status.tapped).toBe(false);
      expect(status.flipped).toBe(false);
      expect(status.faceDown).toBe(false);
      expect(status.phasedOut).toBe(false);
    });

    it('should have four status categories', () => {
      const status = createDefaultPermanentStatus();
      const keys = Object.keys(status);
      expect(keys).toHaveLength(4);
      expect(keys).toContain('tapped');
      expect(keys).toContain('flipped');
      expect(keys).toContain('faceDown');
      expect(keys).toContain('phasedOut');
    });
  });

  describe('Rule 400 - Zones', () => {
    it('should have all eight zones defined', () => {
      expect(Zone.LIBRARY).toBe('library');
      expect(Zone.HAND).toBe('hand');
      expect(Zone.BATTLEFIELD).toBe('battlefield');
      expect(Zone.GRAVEYARD).toBe('graveyard');
      expect(Zone.STACK).toBe('stack');
      expect(Zone.EXILE).toBe('exile');
      expect(Zone.COMMAND).toBe('command');
      expect(Zone.ANTE).toBe('ante');
    });
  });

  describe('Card types', () => {
    it('should have all major card types defined', () => {
      expect(CardType.ARTIFACT).toBe('artifact');
      expect(CardType.CREATURE).toBe('creature');
      expect(CardType.ENCHANTMENT).toBe('enchantment');
      expect(CardType.INSTANT).toBe('instant');
      expect(CardType.SORCERY).toBe('sorcery');
      expect(CardType.LAND).toBe('land');
      expect(CardType.PLANESWALKER).toBe('planeswalker');
    });
  });
});
