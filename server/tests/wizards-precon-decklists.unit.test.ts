import { describe, expect, it } from 'vitest';
import {
  extractWizardsDecklistSection,
  normalizeWizardsPreconCardName,
  parseWizardsDecklistSection,
  parseWizardsDecklistLine,
  parseWizardsDecklistFromAnnouncement,
  parseWizardsGathererEmbeddedDeck,
  stripParentheticalFromCardName,
  tokenizeRunOnCardNames,
} from '../src/services/wizardsPreconDecklists.js';

const SAMPLE_FIN_LIMIT_BREAK =
  "Cloud, Ex-SOLDIER [5ddvkwnWALLZWBo9LDbuTr] Tifa, Martial Artist [2w9IrgGnT5yhvX7M7mFVtk] Cid, Freeflier Pilot Cloud's Limit Break Sol Ring [5fMjIsPVfLnCE5tkeGlttg] Command Tower [4k52BOmjNnRDdQdliqoecP] 3 Mountain [2Fw82thSVrXR3ehEByLX0u] 3 Forest [3sNJjvHre3DvlTy5g3FZ4P] 3 Plains [cuPpZr6kShbqXbKkT1Z21]";

const SAMPLE_BRC_MISHRA =
  '1 Mishra, Eminent One 1 Ashnod the Uncaring 1 Glint Raker 1 Sol Ring 1 Command Tower 4 Swamp 5 Island 4 Mountain';

describe('wizards precon decklists', () => {
  it('parses Brothers War count-prefixed deck text', () => {
    const lines = parseWizardsDecklistLine(SAMPLE_BRC_MISHRA);
    expect(lines.some((line) => line.name === 'Mishra, Eminent One')).toBe(true);
    expect(lines.some((line) => line.name === 'Sol Ring')).toBe(true);
    expect(lines.find((line) => line.name === 'Swamp')?.count).toBe(4);
  });

  it('parses Final Fantasy bracket-id deck text using oracle names', () => {
    const knownNames = [
      "Cloud, Ex-SOLDIER",
      'Tifa, Martial Artist',
      'Cid, Freeflier Pilot',
      "Cloud's Limit Break",
      'Sol Ring',
      'Command Tower',
      'Mountain',
      'Forest',
      'Plains',
    ];
    const lines = parseWizardsDecklistLine(SAMPLE_FIN_LIMIT_BREAK, knownNames);
    expect(lines.some((line) => line.name === "Cloud, Ex-SOLDIER")).toBe(true);
    expect(lines.some((line) => line.name === 'Sol Ring')).toBe(true);
    expect(lines.find((line) => line.name === 'Mountain')?.count).toBe(3);
  });

  it('extracts per-line decklists from Wizards announcement text', () => {
    const content = `
 Limit Break (FINAL FANTASY VII)

Cloud, Ex-SOLDIER [5ddvkwnWALLZWBo9LDbuTr]
Tifa, Martial Artist [2w9IrgGnT5yhvX7M7mFVtk]
Sol Ring [5fMjIsPVfLnCE5tkeGlttg]
3 Mountain [2Fw82thSVrXR3ehEByLX0u]
${Array.from({ length: 60 }, (_, i) => `Card ${i}`).join('\n')}

 Limit Break Tokens
`;
    const lines = extractWizardsDecklistSection(content, 'Limit Break');
    const parsed = parseWizardsDecklistSection(lines);
    expect(lines.length).toBeGreaterThanOrEqual(50);
    expect(parsed.some((line) => line.name === 'Sol Ring')).toBe(true);
    expect(parsed.find((line) => line.name === 'Mountain')?.count).toBe(3);
  });

  it('parses gatherer embedded deck blobs', () => {
    const content = `
# Aura of Courage
a:2:{i:0;O:8:"stdClass":3:{s:9:"card_meta";O:8:"stdClass":2:{s:5:"title";s:8:"Sol Ring";s:22:"field_card_image_front";a:0:{}}s:4:"type";s:8:"artifact";s:10:"deck_count";s:1:"1";}}
# Draconic Rage
`;
    const parsed = parseWizardsGathererEmbeddedDeck(content, 'Aura of Courage');
    expect(parsed).toEqual([{ name: 'Sol Ring', count: 1 }]);
  });

  it('parses single-deck Secret Lair commander pages', () => {
    const content = `
## Goblin Storm Commander Decklist
Zada, Hedron Grinder Sol Ring Command Tower 7 Mountain 1 Goblin Storm 8 Mountain
Secret Lair Commander Deck: Goblin Storm was designed by Studio X
`;
    const parsed = parseWizardsDecklistFromAnnouncement(content, 'Goblin Storm');
    // Tiny fixture — full deck is covered by SQLite integration test.
    expect(parsed).toBeNull();
    const lines = parseWizardsDecklistLine(
      'Zada, Hedron Grinder Sol Ring Command Tower 7 Mountain',
      ['Zada, Hedron Grinder', 'Sol Ring', 'Command Tower', 'Mountain'],
    );
    expect(lines.some((line) => line.name === 'Zada, Hedron Grinder')).toBe(true);
    expect(lines.some((line) => line.name === 'Sol Ring')).toBe(true);
    expect(lines.find((line) => line.name === 'Mountain')?.count).toBe(7);
  });

  it('strips crossover theme labels from Marvel-style card names', () => {
    expect(stripParentheticalFromCardName('Arcane Signet (Avengers)')).toBe('Arcane Signet');
    expect(normalizeWizardsPreconCardName('Arcane Signet (Avengers)')).toBe('Arcane Signet');
    expect(normalizeWizardsPreconCardName('Arcane Signet Avengers')).toBe('Arcane Signet');
    expect(normalizeWizardsPreconCardName('Sol Ring Avengers')).toBe('Sol Ring');
    expect(normalizeWizardsPreconCardName('Command Tower (Villains)')).toBe('Command Tower');
    expect(normalizeWizardsPreconCardName('Command Tower (The Fantastic Four)')).toBe('Command Tower');
  });

  it('tokenizes run-on card name blocks', () => {
    const lines = tokenizeRunOnCardNames('1 Sol Ring 1 Command Tower 3 Mountain', [
      'Sol Ring',
      'Command Tower',
      'Mountain',
    ]);
    expect(lines).toEqual([
      { name: 'Sol Ring', count: 1 },
      { name: 'Command Tower', count: 1 },
      { name: 'Mountain', count: 3 },
    ]);
  });
});
