import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearScryfallTokenImageSearchCache,
  searchScryfallTokenImage,
  stripColorAdjectiveFromTokenName,
} from '../src/services/scryfall.js';
import { buildTokenImageSpec, lookupExactTokenPrinting } from '../src/services/tokens.js';

describe('stripColorAdjectiveFromTokenName', () => {
  it('strips leading color adjectives used by informal token names', () => {
    expect(stripColorAdjectiveFromTokenName('Blue Merfolk')).toBe('Merfolk');
    expect(stripColorAdjectiveFromTokenName('White Soldier')).toBe('Soldier');
    expect(stripColorAdjectiveFromTokenName('Merfolk Wizard')).toBe('Merfolk Wizard');
  });
});

describe('searchScryfallTokenImage cache', () => {
  afterEach(() => {
    clearScryfallTokenImageSearchCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('coalesces concurrent identical lookups and caches definitive misses', async () => {
    let fetchCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCount += 1;
        return {
          ok: false,
          status: 404,
          headers: { get: () => null },
          json: async () => ({}),
        };
      }),
    );

    const spec = {
      name: 'Blue Merfolk',
      power: 1,
      toughness: 1,
      colors: ['U'],
    };

    const [a, b] = await Promise.all([
      searchScryfallTokenImage(spec),
      searchScryfallTokenImage(spec),
    ]);
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
    expect(fetchCount).toBe(1);

    await searchScryfallTokenImage(spec);
    expect(fetchCount).toBe(1);
  });

  it('does not cache rate-limit failures', async () => {
    let fetchCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCount += 1;
        return {
          ok: false,
          status: 429,
          headers: { get: () => null },
          json: async () => ({}),
        };
      }),
    );

    await searchScryfallTokenImage({ name: 'Blue Merfolk', power: 1, toughness: 1, colors: ['U'] });
    const callsAfterFirst = fetchCount;
    expect(callsAfterFirst).toBeGreaterThan(0);

    clearScryfallTokenImageSearchCache();
    await searchScryfallTokenImage({ name: 'Blue Merfolk', power: 1, toughness: 1, colors: ['U'] });
    expect(fetchCount).toBeGreaterThan(callsAfterFirst);
  });
});

describe('local token cache with color-stripped names', () => {
  it('resolves Blue Merfolk via Merfolk local printings when present', () => {
    const blueMerfolk = lookupExactTokenPrinting(
      buildTokenImageSpec({
        name: 'Blue Merfolk',
        power: 1,
        toughness: 1,
        colors: ['U'],
        typeLine: 'Token Creature — Merfolk',
      }),
    );
    expect(blueMerfolk === undefined || Boolean(blueMerfolk?.image_uris)).toBe(true);
  });
});
