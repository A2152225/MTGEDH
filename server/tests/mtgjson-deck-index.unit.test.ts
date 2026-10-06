import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCommanderDeckIndex,
  isCommanderDeckType,
  listLocalDeckEntriesMissingFromIndex,
} from '../src/services/mtgJsonDeckIndex.js';
import { COMMANDER_PRECONS, searchPrecons } from '../../shared/src/precons.js';

const tempDirs: string[] = [];

function makeDeckDir(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgjson-decks-'));
  tempDirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file));
    fs.rmdirSync(dir);
  }
});

const deck = (name: string, code: string, type: string) => ({ data: { name, code, type, commander: [], mainBoard: [] } });

describe('MTGJSON deck index for the precon bake', () => {
  it('treats only Commander deck products as commander decks', () => {
    expect(isCommanderDeckType('Commander Deck')).toBe(true);
    expect(isCommanderDeckType('MTGO Commander Deck')).toBe(true);
    for (const type of [
      'Bundle Land Pack',
      'Secret Lair Drop',
      'Booster Battle Pack Packet',
      'Welcome Deck',
      'Box Set',
      'Demo Deck',
      'Theme Deck',
      'Jumpstart',
      'Brawl Deck',
      'Historic Brawl Precon Deck',
      '',
      undefined,
    ]) {
      expect(isCommanderDeckType(type), String(type)).toBe(false);
    }
  });

  it('lists local deck files that the DeckList index does not know yet', () => {
    const dir = makeDeckDir({
      'KnownDeck_C21.json': deck('Known Deck', 'C21', 'Commander Deck'),
      'TramplesaurusRex_FDC.json': deck('Tramplesaurus Rex', 'FDC', 'Commander Deck'),
      'ForestLandPack_ECL.json': deck('Forest Land Pack', 'ECL', 'Bundle Land Pack'),
      'Broken_XXX.json': '{not json',
      'README.txt': 'ignored',
    });
    const skipped: string[] = [];
    const extras = listLocalDeckEntriesMissingFromIndex(dir, ['knowndeck_c21'], (file) => skipped.push(file));
    expect(extras.map((entry) => entry.fileName).sort()).toEqual(['ForestLandPack_ECL', 'TramplesaurusRex_FDC']);
    expect(extras.find((entry) => entry.fileName === 'TramplesaurusRex_FDC')).toEqual({
      code: 'FDC',
      fileName: 'TramplesaurusRex_FDC',
      name: 'Tramplesaurus Rex',
      type: 'Commander Deck',
    });
    expect(skipped).toEqual(['Broken_XXX.json']);
    expect(listLocalDeckEntriesMissingFromIndex(path.join(dir, 'missing'), [])).toEqual([]);
  });

  it('indexes new local commander decks and drops land packs, Secret Lair drops and Brawl decks', () => {
    const index = buildCommanderDeckIndex([
      { name: 'Tramplesaurus Rex', code: 'FDC', fileName: 'TramplesaurusRex_FDC', type: 'Commander Deck' },
      { name: 'Hatsune Miku', code: 'SLD', fileName: 'HatsuneMiku_SLD', type: 'Commander Deck' },
      { name: 'Hatsune Miku: Digital Diva', code: 'SLD', fileName: 'HatsuneMikuDigitalDiva_SLD', type: 'Secret Lair Drop' },
      { name: 'Forest Land Pack', code: 'ECL', fileName: 'ForestLandPack_ECL', type: 'Bundle Land Pack' },
      { name: 'Rakdos Booster Battle Pack', code: 'RTR', fileName: 'Rakdos_RTR', type: 'Welcome Deck' },
      { name: 'Draconic Destruction', code: 'ELD', fileName: 'DraconicDestruction_ELD', type: 'Brawl Deck' },
      { name: 'Mind Seize (Commander 2013)', code: 'C13', fileName: 'MindSeize_C13', type: 'Commander Deck' },
    ]);
    expect(index.get('tramplesaurus rex')?.[0]?.fileName).toBe('TramplesaurusRex_FDC');
    expect(index.get('hatsune miku')?.map((entry) => entry.fileName)).toEqual(['HatsuneMiku_SLD']);
    expect(index.has('hatsune miku: digital diva')).toBe(false);
    expect(index.has('forest land pack')).toBe(false);
    expect(index.has('rakdos booster battle pack')).toBe(false);
    expect(index.has('draconic destruction')).toBe(false);
    expect(index.get('mind seize')?.[0]?.fileName).toBe('MindSeize_C13');
  });

  it('catalogs the Foundations Commander, Reality Fracture Commander and Hatsune Miku precons', () => {
    const year2026 = COMMANDER_PRECONS.find((year) => year.year === 2026);
    const decksBySet = (code: string) => year2026?.sets.find((set) => set.code === code)?.decks ?? [];
    expect(decksBySet('FDC').map((d) => [d.name, d.commanders[0]])).toEqual([
      ['Calling All Angels', 'Giada, Font of Hope'],
      ['Keen Engineering', 'Sai, Master Thopterist'],
      ['Wretched Ranks', 'Ghoulcaller Gisa'],
      ['Reign of Dragons', 'Lathliss, Dragon Queen'],
      ['Tramplesaurus Rex', 'Ghalta, Primal Hunger'],
    ]);
    expect(decksBySet('FRC').map((d) => [d.name, d.commanders[0], d.colorIdentity])).toEqual([
      ['Multiverse Reforged', 'Jace, Multiverse Architect', 'WUBR'],
    ]);
    expect(decksBySet('SLD').find((d) => d.name === 'Hatsune Miku')?.commanders).toEqual(["Trostani, Selesnya's Voice"]);
    expect(searchPrecons('Tramplesaurus').map((hit) => hit.set.code)).toEqual(['FDC']);
  });
});