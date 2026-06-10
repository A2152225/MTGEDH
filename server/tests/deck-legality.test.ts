import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('validateDeck commander restrictions', () => {
  it('flags cards on the live Scryfall ban list even when local legalities say legal', async () => {
    const { validateDeck } = await import('../src/services/scryfall');

    const result = validateDeck(
      'commander',
      [
        {
          id: 'dockside',
          name: 'Dockside Extortionist',
          legalities: { commander: 'legal' },
        },
      ],
      {
        formatRestrictions: {
          banned: new Set(['dockside extortionist']),
          restricted: new Set(),
        },
      },
    );

    expect(result.illegal).toEqual([
      { name: 'Dockside Extortionist', reason: 'banned in commander (Scryfall ban list)' },
    ]);
  });

  it('still flags not_legal cards from the resolved card record (e.g. unreleased sets)', async () => {
    const { validateDeck } = await import('../src/services/scryfall');

    const result = validateDeck(
      'commander',
      [
        {
          id: 'namor',
          name: 'Namor the Sub-Mariner',
          legalities: { commander: 'not_legal' },
        },
      ],
      { formatRestrictions: { banned: new Set(), restricted: new Set() } },
    );

    expect(result.illegal).toEqual([
      { name: 'Namor the Sub-Mariner', reason: 'not legal in commander (not_legal)' },
    ]);
  });
});

describe('local card lookup commander legality preference', () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    try {
      const localLookup = await import('../src/services/localCardLookup');
      localLookup.resetLocalCardLookupForTests();
    } catch {
      // ignore
    }

    delete process.env.CARD_LOOKUP_SQLITE_FILE;
    delete process.env.CARD_LOOKUP_ORACLE_FILE;
    delete process.env.CARD_LOOKUP_ATOMIC_FILE;

    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }

    vi.resetModules();
  });

  it('prefers commander-legal oracle entries over duplicate junk printings for the same face name', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgedh-card-lookup-'));
    fs.writeFileSync(
      path.join(tempDir, 'oracle-cards.json'),
      JSON.stringify([
        {
          id: 'bad-itlimoc',
          name: 'Growing Rites of Itlimoc // Growing Rites of Itlimoc',
          legalities: { commander: 'not_legal' },
          card_faces: [
            { name: 'Growing Rites of Itlimoc', oracle_text: 'Bad duplicate face.' },
            { name: 'Growing Rites of Itlimoc', oracle_text: 'Bad duplicate face.' },
          ],
        },
        {
          id: 'good-itlimoc',
          name: 'Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun',
          legalities: { commander: 'legal' },
          card_faces: [
            {
              name: 'Growing Rites of Itlimoc',
              oracle_text: 'When Growing Rites of Itlimoc enters, look at the top four cards of your library.',
            },
            { name: 'Itlimoc, Cradle of the Sun', oracle_text: '{T}: Add {G} for each creature you control.' },
          ],
        },
      ]),
    );
    fs.writeFileSync(path.join(tempDir, 'AtomicCards.json'), JSON.stringify({ data: {} }));

    process.env.CARD_LOOKUP_SQLITE_FILE = path.join(tempDir, 'card-lookup.sqlite');
    process.env.CARD_LOOKUP_ORACLE_FILE = path.join(tempDir, 'oracle-cards.json');
    process.env.CARD_LOOKUP_ATOMIC_FILE = path.join(tempDir, 'AtomicCards.json');

    const localLookup = await import('../src/services/localCardLookup');
    const byName = await localLookup.lookupLocalCards(['Growing Rites of Itlimoc']);

    const card = byName.get('growing rites of itlimoc');
    expect(card?.legalities?.commander).toBe('legal');
    expect(card?.name).toBe('Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun');
  });
});
