import { describe, it, expect } from 'vitest';
import {
  commanderHasNoMaximumDeckSize,
  validateCommanderDeck,
} from './CommanderDeckValidator';

const wrg = (name: string, oracle = ''): any => ({
  id: name,
  name,
  type_line: 'Legendary Creature — Test',
  oracle_text: oracle,
  color_identity: ['G'],
});

const forest = (i: number): any => ({
  id: `f${i}`,
  name: 'Forest',
  type_line: 'Basic Land — Forest',
  oracle_text: '',
  color_identity: ['G'],
});

const deckOf = (n: number) => Array.from({ length: n }, (_, i) => forest(i));

const WHTZ = 'A deck with this commander has no maximum deck size.';

describe('commanderHasNoMaximumDeckSize (Whtz)', () => {
  it('is true for the printed Whtz clause on oracle_text or oracleText', () => {
    expect(commanderHasNoMaximumDeckSize({ oracle_text: WHTZ })).toBe(true);
    expect(commanderHasNoMaximumDeckSize({ oracleText: WHTZ })).toBe(true);
  });

  it('is false for ordinary commanders and empty text', () => {
    expect(commanderHasNoMaximumDeckSize({ oracle_text: 'Trample' })).toBe(false);
    expect(commanderHasNoMaximumDeckSize({ oracle_text: '' })).toBe(false);
    expect(commanderHasNoMaximumDeckSize(null)).toBe(false);
  });
});

describe('validateCommanderDeck honors no-maximum commanders', () => {
  const cmd = wrg('Whtz, the Bibliophile', WHTZ);
  const normal = wrg("Freyalise, Llanowar's Fury", 'T: Add G.');

  it('still requires the 100-card minimum (99 plus commander)', () => {
    const result = validateCommanderDeck(deckOf(50), [cmd]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.type === 'card_count' && /at least 99/.test(e.message))).toBe(true);
  });

  it('allows decks larger than 99 plus a no-maximum commander', () => {
    const result = validateCommanderDeck(deckOf(140), [cmd]);
    expect(result.errors.filter((e) => e.type === 'card_count')).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('still errors when a normal commander deck is over 100 cards', () => {
    const result = validateCommanderDeck(deckOf(140), [normal]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.type === 'card_count' && /Expected 99/.test(e.message))).toBe(true);
  });

  it('accepts an exact 99 plus a no-maximum commander', () => {
    const result = validateCommanderDeck(deckOf(99), [cmd]);
    expect(result.errors.filter((e) => e.type === 'card_count')).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
