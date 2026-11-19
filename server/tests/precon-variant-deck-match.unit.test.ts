import { describe, expect, it } from 'vitest';

import { matchCatalogPrecon } from '../src/services/preconVariantDeckMatch.js';

describe('matchCatalogPrecon', () => {
  it('matches a saved Doctor Who deck by name, including a parenthetical suffix', () => {
    expect(matchCatalogPrecon({ deckName: 'Timey-Wimey (Doctor Who 2023)' })).toEqual({
      setCode: 'WHO',
      deckName: 'Timey-Wimey',
    });
  });

  it('matches the precon whose commanders are all in the library', () => {
    expect(matchCatalogPrecon({
      deckName: 'My Doctor deck',
      cardNames: ['Sol Ring', 'The Tenth Doctor', 'Rose Tyler', 'Command Tower'],
    })).toEqual({
      setCode: 'WHO',
      deckName: 'Timey-Wimey',
    });
  });

  it('prefers the larger commander package when a single legendary from another precon is also present', () => {
    expect(matchCatalogPrecon({
      cardNames: ['Davros, Dalek Creator', 'The Tenth Doctor', 'Rose Tyler'],
    })).toEqual({
      setCode: 'WHO',
      deckName: 'Timey-Wimey',
    });
  });

  it('does not guess when two equal commander packages are both present', () => {
    expect(matchCatalogPrecon({
      cardNames: ['Giada, Font of Hope', 'Sai, Master Thopterist'],
    })).toBeNull();
  });
});
