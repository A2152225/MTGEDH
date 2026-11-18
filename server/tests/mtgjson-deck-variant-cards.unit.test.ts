import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { COMMANDER_PRECONS } from '../../shared/src/precons.js';
import {
  classifyPlanarType,
  classifySchemeType,
  extractMtgJsonVariantCards,
} from '../src/services/mtgJsonDeckVariantCards.js';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mtgjson-decks');

function loadDeck(fileName: string): any {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, fileName), 'utf8')).data;
}

describe('MTGJSON planar / scheme extraction', () => {
  it('classifies planes vs phenomena by type line, not layout', () => {
    expect(classifyPlanarType('Plane — Skaro')).toBe('plane');
    expect(classifyPlanarType('Phenomenon')).toBe('phenomenon');
    expect(classifySchemeType('Scheme')).toBe('scheme');
    expect(classifySchemeType('Ongoing Scheme')).toBe('ongoing_scheme');
  });

  it('Masters of Evil: 9 planes + Unleash the Flux; Davros is the only commander', () => {
    const deck = loadDeck('MastersOfEvil_WHO.trimmed.json');
    const { planar, schemes } = extractMtgJsonVariantCards(deck);

    expect(planar).toHaveLength(10);
    expect(planar.filter((c) => c.kind === 'plane')).toHaveLength(9);
    expect(planar.filter((c) => c.kind === 'phenomenon').map((c) => c.name)).toEqual(['Unleash the Flux']);
    expect(planar.map((c) => c.name)).toContain('City of the Daleks');
    expect(planar.every((c) => c.count === 1)).toBe(true);
    expect(planar.every((c) => Boolean(c.scryfallOracleId))).toBe(true);
    expect(schemes).toEqual([]);

    // Commanders come from the `commander` array. The Dalek Emperor is commander-LEGAL
    // (leadershipSkills.commander) but is just a card in the 99 here.
    expect(deck.commander.map((c: any) => c.name)).toEqual(['Davros, Dalek Creator']);
    const emperor = deck.mainBoard.find((c: any) => c.name === 'The Dalek Emperor');
    expect(emperor?.leadershipSkills?.commander).toBe(true);
  });

  it('Timey-Wimey (Doctor + companion): two commanders, one phenomenon', () => {
    const deck = loadDeck('TimeyWimey_WHO.trimmed.json');
    expect(deck.commander.map((c: any) => c.name)).toEqual(['The Tenth Doctor', 'Rose Tyler']);
    const { planar } = extractMtgJsonVariantCards(deck);
    expect(planar).toHaveLength(10);
    expect(planar.filter((c) => c.kind === 'phenomenon').map((c) => c.name)).toEqual([
      'Human—Time Lord Meta-Crisis',
    ]);
  });

  it('Elemental Thunder (Planechase Deck): 10 planes, no phenomena, no schemes', () => {
    const deck = loadDeck('ElementalThunder_HOP.trimmed.json');
    const { planar, schemes } = extractMtgJsonVariantCards(deck);
    expect(planar).toHaveLength(10);
    expect(planar.every((c) => c.kind === 'plane')).toBe(true);
    expect(planar[0]?.name).toBe('Eloren Wilds');
    expect(schemes).toEqual([]);
  });

  it('handles missing arrays, blank names and duplicate entries', () => {
    expect(extractMtgJsonVariantCards(undefined)).toEqual({ planar: [], schemes: [] });
    expect(extractMtgJsonVariantCards({})).toEqual({ planar: [], schemes: [] });
    const out = extractMtgJsonVariantCards({
      planes: [
        { name: 'Naya', type: 'Plane — Alara', count: 1 },
        { name: ' naya ', type: 'Plane — Alara' },
        { name: '', type: 'Plane' },
      ],
      schemes: [
        { name: 'Behold the Power of Destruction', type: 'Scheme' },
        { name: 'Realm Domination', type: 'Ongoing Scheme' },
      ],
    });
    expect(out.planar).toEqual([{ name: 'Naya', kind: 'plane', count: 2, scryfallOracleId: null }]);
    expect(out.schemes.map((c) => [c.name, c.kind])).toEqual([
      ['Behold the Power of Destruction', 'scheme'],
      ['Realm Domination', 'ongoing_scheme'],
    ]);
  });
});

describe('precon catalog: Doctor Who commanders', () => {
  it('Masters of Evil lists Davros alone; Doctor decks pair Doctor + companion', () => {
    const who = COMMANDER_PRECONS.flatMap((year) => year.sets).find((set) => set.code === 'WHO');
    const byName = new Map((who?.decks ?? []).map((deck) => [deck.name, deck.commanders]));
    expect(byName.get('Masters of Evil')).toEqual(['Davros, Dalek Creator']);
    expect(byName.get('Blast from the Past')).toEqual(['The Fourth Doctor', 'Sarah Jane Smith']);
    expect(byName.get('Paradox Power')).toEqual(['The Thirteenth Doctor', 'Yasmin Khan']);
    expect(byName.get('Timey-Wimey')).toEqual(['The Tenth Doctor', 'Rose Tyler']);
  });
});

describe('precon variant card store', () => {
  let store: typeof import('../src/services/preconDeckVariantCardStore.js');

  beforeAll(async () => {
    process.env.PRECON_DECKLIST_SQLITE_FILE = ':memory:';
    store = await import('../src/services/preconDeckVariantCardStore.js');
  });

  it('round-trips planar cards in file order and records the deck as checked', () => {
    const cards = extractMtgJsonVariantCards(loadDeck('MastersOfEvil_WHO.trimmed.json'));
    expect(store.hasCheckedPreconVariantCards('who', 'Masters of Evil')).toBe(false);

    store.upsertPreconVariantCards('who', 'Masters of Evil', cards);

    expect(store.hasCheckedPreconVariantCards('WHO', 'Masters of Evil')).toBe(true);
    const read = store.getPreconVariantCards('WHO', 'Masters of Evil');
    expect(read.planar).toEqual(cards.planar);
    expect(read.schemes).toEqual([]);
    expect(read.planar.find((c) => c.kind === 'phenomenon')?.name).toBe('Unleash the Flux');
  });

  it('re-upsert replaces rows instead of duplicating them', () => {
    const cards = extractMtgJsonVariantCards(loadDeck('MastersOfEvil_WHO.trimmed.json'));
    store.upsertPreconVariantCards('WHO', 'Masters of Evil', cards);
    store.upsertPreconVariantCards('WHO', 'Masters of Evil', cards);
    expect(store.getPreconVariantCards('WHO', 'Masters of Evil').planar).toHaveLength(10);
  });

  it('a deck with no planar cards is still marked checked, and reads back empty', () => {
    store.upsertPreconVariantCards('CMD', 'Heavenly Inferno', { planar: [], schemes: [] });
    expect(store.hasCheckedPreconVariantCards('CMD', 'Heavenly Inferno')).toBe(true);
    expect(store.getPreconVariantCards('CMD', 'Heavenly Inferno')).toEqual({ planar: [], schemes: [] });
  });

  it('stores scheme decks separately from planar decks', () => {
    store.upsertPreconVariantCards('ARC', 'Test Archenemy', {
      planar: [],
      schemes: [
        { name: 'Behold the Power of Destruction', kind: 'scheme', count: 1, scryfallOracleId: null },
        { name: 'Realm Domination', kind: 'ongoing_scheme', count: 1, scryfallOracleId: null },
      ],
    });
    const read = store.getPreconVariantCards('ARC', 'Test Archenemy');
    expect(read.planar).toEqual([]);
    expect(read.schemes.map((c) => c.kind)).toEqual(['scheme', 'ongoing_scheme']);
  });
});
