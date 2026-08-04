import { describe, expect, it } from 'vitest';

import {
  aggregateDeckCardQuantities,
  extractCardNamesFromDeckText,
  getLineAtCaret,
  getLineNumberAtCaret,
  parseCardNameFromDeckLine,
  parseDeckLineEntry,
  shouldSkipDeckLine,
} from '../src/utils/deckListLine';

describe('deckListLine', () => {
  it('skips section headers and comments', () => {
    expect(shouldSkipDeckLine('COMMANDER')).toBe(true);
    expect(shouldSkipDeckLine('// comment')).toBe(true);
    expect(shouldSkipDeckLine('SB: 1 Negate')).toBe(true);
    expect(shouldSkipDeckLine('1 Sol Ring')).toBe(false);
  });

  it('parses quantity prefixes and set codes', () => {
    expect(parseCardNameFromDeckLine('1 Sol Ring')).toBe('Sol Ring');
    expect(parseCardNameFromDeckLine('3x Lightning Bolt')).toBe('Lightning Bolt');
    expect(parseCardNameFromDeckLine('Sol Ring (C14) 276')).toBe('Sol Ring');
    expect(parseCardNameFromDeckLine('Counterspell x2')).toBe('Counterspell');
    expect(parseDeckLineEntry('10 Forest')).toEqual({ name: 'Forest', count: 10 });
    expect(parseDeckLineEntry('Forest')).toEqual({ name: 'Forest', count: 1 });
  });

  it('extracts unique names in order', () => {
    const text = [
      'COMMANDER',
      '1 Atraxa, Praetors\' Voice',
      '1 Sol Ring',
      '1 Sol Ring',
      '',
      '1 Arcane Signet',
    ].join('\n');
    expect(extractCardNamesFromDeckText(text)).toEqual([
      "Atraxa, Praetors' Voice",
      'Sol Ring',
      'Arcane Signet',
    ]);
  });

  it('aggregates duplicate quantities including multi-copy lines', () => {
    const text = [
      '1 Sol Ring',
      '10 Forest',
      '1 Forest',
      '1 Sol Ring',
    ].join('\n');
    expect(aggregateDeckCardQuantities(text)).toEqual([
      { name: 'Sol Ring', count: 2 },
      { name: 'Forest', count: 11 },
    ]);
  });

  it('reads the line under the caret', () => {
    const text = '1 Sol Ring\n1 Arcane Signet\n';
    expect(getLineAtCaret(text, 0)).toBe('1 Sol Ring');
    expect(getLineAtCaret(text, 12)).toBe('1 Arcane Signet');
    expect(getLineNumberAtCaret(text, 0)).toBe(1);
    expect(getLineNumberAtCaret(text, 12)).toBe(2);
  });
});
