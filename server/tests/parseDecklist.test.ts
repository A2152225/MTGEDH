import { describe, it, expect } from 'vitest';
import { parseDecklist } from '../src/services/scryfall';

describe('parseDecklist', () => {
  describe('basic formats', () => {
    it('parses "1 Sol Ring" format', () => {
      const result = parseDecklist('1 Sol Ring');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'Sol Ring', count: 1 });
    });

    it('parses "1x Sol Ring" format', () => {
      const result = parseDecklist('1x Sol Ring');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'Sol Ring', count: 1 });
    });

    it('parses "Sol Ring x1" format', () => {
      const result = parseDecklist('Sol Ring x1');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'Sol Ring', count: 1 });
    });

    it('parses card name only (no quantity)', () => {
      const result = parseDecklist('Sol Ring');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'Sol Ring', count: 1 });
    });

    it('parses multiple cards', () => {
      const result = parseDecklist(`1 Sol Ring
2 Arcane Signet
1 Command Tower`);
      expect(result).toHaveLength(3);
      expect(result).toContainEqual({ name: 'Sol Ring', count: 1 });
      expect(result).toContainEqual({ name: 'Arcane Signet', count: 2 });
      expect(result).toContainEqual({ name: 'Command Tower', count: 1 });
    });
  });

  describe('Moxfield/Scryfall formats with set codes', () => {
    it('parses "1 Sol Ring (C14) 276" format', () => {
      const result = parseDecklist('1 Sol Ring (C14) 276');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'Sol Ring', count: 1 });
    });

    it('parses "2 Arcane Signet (ELD) 331" format', () => {
      const result = parseDecklist('2 Arcane Signet (ELD) 331');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'Arcane Signet', count: 2 });
    });

    it('parses "1x Sol Ring (C14) 276" format', () => {
      const result = parseDecklist('1x Sol Ring (C14) 276');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'Sol Ring', count: 1 });
    });

    it('parses "1 Sol Ring (C14:276)" format', () => {
      const result = parseDecklist('1 Sol Ring (C14:276)');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'Sol Ring', count: 1 });
    });

    it('parses "1 Sol Ring 276 (C14)" format', () => {
      const result = parseDecklist('1 Sol Ring 276 (C14)');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'Sol Ring', count: 1 });
    });

    it('parses card with just set code "(C14)"', () => {
      const result = parseDecklist('1 Sol Ring (C14)');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'Sol Ring', count: 1 });
    });

    it('parses collector number with letter suffix like "276a"', () => {
      const result = parseDecklist('1 Chaos Orb (2ED) 236a');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'Chaos Orb', count: 1 });
    });
  });

  describe('edge cases', () => {
    it('handles blank lines', () => {
      const result = parseDecklist(`1 Sol Ring

2 Arcane Signet`);
      expect(result).toHaveLength(2);
    });

    it('skips sideboard marker lines (SB: prefix)', () => {
      const result = parseDecklist(`1 Sol Ring
SB: 1 Counterspell`);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Sol Ring');
    });

    it('skips SIDEBOARD section header', () => {
      // The parser skips lines that are exactly "SIDEBOARD" but does not
      // skip cards that follow (they are treated as part of the deck)
      const result = parseDecklist(`1 Sol Ring
SIDEBOARD
1 Negate`);
      expect(result).toHaveLength(2);
      expect(result).toContainEqual({ name: 'Sol Ring', count: 1 });
      expect(result).toContainEqual({ name: 'Negate', count: 1 });
    });

    it('skips comment lines', () => {
      const result = parseDecklist(`1 Sol Ring
// This is a comment
# Another comment
2 Arcane Signet`);
      expect(result).toHaveLength(2);
    });

    it('skips section headers', () => {
      const result = parseDecklist(`Deck
1 Sol Ring
Commander
1 Ur-Dragon
Mainboard
2 Arcane Signet`);
      expect(result).toHaveLength(3);
    });

    it('aggregates duplicate card entries', () => {
      const result = parseDecklist(`1 Sol Ring
1 Sol Ring`);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'Sol Ring', count: 2 });
    });

    it('normalizes card names with extra whitespace', () => {
      const result = parseDecklist('1  Sol   Ring');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Sol Ring');
    });

    it('handles cards with numbers in name', () => {
      // Cards like "Urza's Factory" should not have trailing text stripped incorrectly
      const result = parseDecklist('1 Channel the Suns');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Channel the Suns');
    });
  });

  describe('full Moxfield deck export', () => {
    it('parses a typical Moxfield export', () => {
      const deckList = `1 Sol Ring (C14) 276
1 Arcane Signet (ELD) 331
1 Command Tower (C17) 263
1 Lightning Bolt (2ED) 161
1 Swords to Plowshares (LEA) 31`;

      const result = parseDecklist(deckList);
      expect(result).toHaveLength(5);
      expect(result).toContainEqual({ name: 'Sol Ring', count: 1 });
      expect(result).toContainEqual({ name: 'Arcane Signet', count: 1 });
      expect(result).toContainEqual({ name: 'Command Tower', count: 1 });
      expect(result).toContainEqual({ name: 'Lightning Bolt', count: 1 });
      expect(result).toContainEqual({ name: 'Swords to Plowshares', count: 1 });
    });
  });
});
