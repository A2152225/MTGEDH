import { describe, expect, it } from 'vitest';

import {
  extractCardNamesFromDeckText,
  getLineAtCaret,
  parseCardNameFromDeckLine,
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

  it('reads the line under the caret', () => {
    const text = '1 Sol Ring\n1 Arcane Signet\n';
    expect(getLineAtCaret(text, 0)).toBe('1 Sol Ring');
    expect(getLineAtCaret(text, 12)).toBe('1 Arcane Signet');
  });
});
