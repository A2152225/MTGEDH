import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchCardsByExactNamesBatch = vi.fn();
const fetchCardByExactNameStrict = vi.fn();

vi.mock('../src/services/scryfall', () => ({
  normalizeName: (name: string) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' '),
  fetchCardsByExactNamesBatch,
  fetchCardByExactNameStrict,
}));

let tempDir: string | null = null;

function writeLookupSources(payload: { oracleCards: any[]; atomicData?: Record<string, any[]> }): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgedh-card-lookup-'));
  fs.writeFileSync(path.join(tempDir, 'oracle-cards.json'), JSON.stringify(payload.oracleCards));
  fs.writeFileSync(path.join(tempDir, 'AtomicCards.json'), JSON.stringify({ data: payload.atomicData || {} }));

  process.env.CARD_LOOKUP_SQLITE_FILE = path.join(tempDir, 'card-lookup.sqlite');
  process.env.CARD_LOOKUP_ORACLE_FILE = path.join(tempDir, 'oracle-cards.json');
  process.env.CARD_LOOKUP_ATOMIC_FILE = path.join(tempDir, 'AtomicCards.json');
}

afterEach(async () => {
  try {
    const localLookup = await import('../src/services/localCardLookup');
    localLookup.resetLocalCardLookupForTests();
  } catch {
    // ignore cleanup import failures
  }

  vi.clearAllMocks();
  vi.resetModules();

  delete process.env.CARD_LOOKUP_SQLITE_FILE;
  delete process.env.CARD_LOOKUP_ORACLE_FILE;
  delete process.env.CARD_LOOKUP_ATOMIC_FILE;

  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('resolveDeckList local table index', () => {
  it('resolves cards from the local lookup table before calling Scryfall', async () => {
    writeLookupSources({
      oracleCards: [
        {
          id: 'local-card-1',
          name: 'Local Card',
          type_line: 'Creature',
          oracle_text: 'Local oracle text',
          image_uris: { normal: 'https://example.test/local-card.jpg' },
        },
      ],
    });

    fetchCardsByExactNamesBatch.mockResolvedValue(new Map());
    fetchCardByExactNameStrict.mockRejectedValue(new Error('strict fetch should not run'));

    const { resolveDeckList } = await import('../src/services/deckImport');
    const result = await resolveDeckList([{ name: 'Local Card', count: 2 }]);

    expect(result.resolvedCards).toHaveLength(2);
    expect(result.missing).toEqual([]);
    expect(result.sourcesUsed).toContain('oracle-cards');
    expect(fetchCardsByExactNamesBatch).not.toHaveBeenCalled();
    expect(fetchCardByExactNameStrict).not.toHaveBeenCalled();
  });

  it('falls back to Scryfall for names missing from the local lookup table', async () => {
    writeLookupSources({ oracleCards: [] });

    fetchCardsByExactNamesBatch.mockResolvedValue(
      new Map([
        [
          'remote card',
          {
            id: 'remote-card-1',
            name: 'Remote Card',
            type_line: 'Instant',
            oracle_text: 'Remote oracle text',
          },
        ],
      ])
    );
    fetchCardByExactNameStrict.mockRejectedValue(new Error('strict fetch should not run'));

    const { resolveDeckList } = await import('../src/services/deckImport');
    const result = await resolveDeckList([{ name: 'Remote Card', count: 1 }]);

    expect(result.resolvedCards).toHaveLength(1);
    expect(result.missing).toEqual([]);
    expect(result.sourcesUsed).toContain('scryfall');
    expect(fetchCardsByExactNamesBatch).toHaveBeenCalledTimes(1);
    expect(fetchCardsByExactNamesBatch).toHaveBeenCalledWith(['Remote Card'], 75, 120);
    expect(fetchCardByExactNameStrict).not.toHaveBeenCalled();
  });
});