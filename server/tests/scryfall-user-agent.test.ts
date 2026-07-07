import { describe, expect, it } from 'vitest';

import { fetchCardByExactNameStrict } from '../src/services/scryfall.js';

describe('Scryfall user agent', () => {
  it('resolves known commander precon cards', async () => {
    const daretti = await fetchCardByExactNameStrict('Daretti, Scrap Savant');
    expect(daretti.name).toBe('Daretti, Scrap Savant');

    const leonardo = await fetchCardByExactNameStrict('Leonardo, the Balance');
    expect(leonardo.name).toBe('Leonardo, the Balance');
  }, 20000);
});
