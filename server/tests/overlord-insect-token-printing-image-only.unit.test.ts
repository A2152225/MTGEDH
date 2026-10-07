import { describe, expect, it } from 'vitest';
import { applyTokenPrintingToCard } from '../src/services/tokens.js';

describe('applyTokenPrintingToCard image-only', () => {
  it('does not overwrite oracle-derived P/T or keywords from a mismatched printing', () => {
    const card: any = {
      name: 'Insect',
      power: '2',
      toughness: '1',
      colors: ['W'],
      keywords: ['flying'],
      oracle_text: 'Flying',
      type_line: 'Token Creature — Insect',
    };
    applyTokenPrintingToCard(card, {
      image_uris: { normal: 'https://example.com/wrong-insect.jpg' },
      printing: {
        name: 'Insect',
        power: '1',
        toughness: '1',
        colors: ['G'],
        keywords: ['infect'],
        oracle_text: 'Infect',
        type_line: 'Token Creature — Insect',
      },
      matchKind: 'fuzzy',
    } as any);
    expect(card.image_uris?.normal).toContain('wrong-insect');
    expect(card.power).toBe('2');
    expect(card.toughness).toBe('1');
    expect(card.colors).toEqual(['W']);
    expect(card.keywords).toEqual(['flying']);
    expect(card.oracle_text).toBe('Flying');
  });
});
