import { describe, expect, it } from 'vitest';
import {
  getPreconDecklistLines,
  parseWizardsRunOnDecklist,
} from '../src/services/bundledPreconDecklists.js';

describe('bundled precon decklists', () => {
  it('parses Wizards run-on deck text into counted lines', () => {
    const lines = parseWizardsRunOnDecklist('1 Sol Ring 11 Plains 13 Swamp');
    expect(lines).toEqual([
      { count: 1, name: 'Sol Ring' },
      { count: 11, name: 'Plains' },
      { count: 13, name: 'Swamp' },
    ]);
  });

  it('loads Commander 2015 Call the Spirits precon decklist', () => {
    const lines = getPreconDecklistLines('C15', 'Call the Spirits');
    expect(lines).toBeTruthy();
    expect((lines || []).length).toBeGreaterThan(70);
    expect((lines || []).some((line) => line.name === 'Sol Ring')).toBe(true);
    expect((lines || []).reduce((sum, line) => sum + (line.count || 1), 0)).toBeGreaterThanOrEqual(99);
  });

  it('loads original Commander Heavenly Inferno from SQLite', () => {
    const lines = getPreconDecklistLines('CMD', 'Heavenly Inferno');
    expect(lines).toBeTruthy();
    expect((lines || []).some((line) => line.name === 'Sol Ring')).toBe(true);
    expect((lines || []).reduce((sum, line) => sum + (line.count || 1), 0)).toBeGreaterThanOrEqual(99);
  });

  it('loads Secrets of Strixhaven Witherbloom Pestilence from SQLite', () => {
    const lines = getPreconDecklistLines('SOC', 'Witherbloom Pestilence');
    expect(lines).toBeTruthy();
    expect((lines || []).some((line) => line.name === 'Dina, Essence Brewer')).toBe(true);
    expect((lines || []).some((line) => line.name === 'Sol Ring')).toBe(true);
    expect((lines || []).reduce((sum, line) => sum + (line.count || 1), 0)).toBe(100);
  });

  it('loads Marvel Super Heroes Avengers Assemble from SQLite', () => {
    const lines = getPreconDecklistLines('MSC', 'Avengers Assemble');
    expect(lines).toBeTruthy();
    expect((lines || []).some((line) => line.name === 'Captain America, Team Leader')).toBe(true);
    expect((lines || []).some((line) => line.name === 'Sol Ring')).toBe(true);
    expect((lines || []).some((line) => line.name === 'Arcane Signet')).toBe(true);
    expect((lines || []).some((line) => line.name === 'Avengers Quinjet')).toBe(true);
    expect((lines || []).reduce((sum, line) => sum + (line.count || 1), 0)).toBe(100);
  });

  it('loads Secret Lair Goblin Storm from SQLite', () => {
    const lines = getPreconDecklistLines('SLD', 'Goblin Storm');
    expect(lines).toBeTruthy();
    expect((lines || []).some((line) => line.name === 'Zada, Hedron Grinder')).toBe(true);
    expect((lines || []).reduce((sum, line) => sum + (line.count || 1), 0)).toBe(100);
  });

  it.each([
    ['FDC', 'Calling All Angels', 'Giada, Font of Hope'],
    ['FDC', 'Keen Engineering', 'Sai, Master Thopterist'],
    ['FDC', 'Wretched Ranks', 'Ghoulcaller Gisa'],
    ['FDC', 'Reign of Dragons', 'Lathliss, Dragon Queen'],
    ['FDC', 'Tramplesaurus Rex', 'Ghalta, Primal Hunger'],
    ['FRC', 'Multiverse Reforged', 'Jace, Multiverse Architect'],
    ['SLD', 'Hatsune Miku', "Trostani, Selesnya's Voice"],
  ])('loads %s %s (baked from local AllDeckFiles) from SQLite', (setCode, deckName, commander) => {
    const lines = getPreconDecklistLines(setCode, deckName);
    expect(lines).toBeTruthy();
    expect((lines || []).some((line) => line.name === commander)).toBe(true);
    expect((lines || []).reduce((sum, line) => sum + (line.count || 1), 0)).toBe(100);
  });

  it('loads TMNT Turtle Power! from SQLite', () => {
    const lines = getPreconDecklistLines('TMC', 'Turtle Power!');
    expect(lines).toBeTruthy();
    expect((lines || []).some((line) => line.name === 'Leonardo, the Balance')).toBe(true);
    expect((lines || []).some((line) => line.name === "April O'Neil, Live on the Scene")).toBe(true);
    expect((lines || []).some((line) => line.name === 'Sol Ring')).toBe(true);
    expect((lines || []).reduce((sum, line) => sum + (line.count || 1), 0)).toBe(100);
  });

  it('loads Lorwyn Eclipsed Blight Curse from SQLite', () => {
    const lines = getPreconDecklistLines('ECC', 'Blight Curse');
    expect(lines).toBeTruthy();
    expect((lines || []).some((line) => line.name === 'Auntie Ool, Cursewretch')).toBe(true);
    expect((lines || []).some((line) => line.name === 'Sol Ring')).toBe(true);
    expect((lines || []).reduce((sum, line) => sum + (line.count || 1), 0)).toBe(100);
  });

  it('loads Ikoria Timeless Wisdom from SQLite', () => {
    const lines = getPreconDecklistLines('C20', 'Timeless Wisdom');
    expect(lines).toBeTruthy();
    expect((lines || []).some((line) => line.name === 'Gavi, Nest Warden')).toBe(true);
    expect((lines || []).some((line) => line.name === 'Sol Ring')).toBe(true);
    expect((lines || []).reduce((sum, line) => sum + (line.count || 1), 0)).toBe(100);
  });

  it('loads Commander 2013 Mind Seize from SQLite', () => {
    const lines = getPreconDecklistLines('C13', 'Mind Seize');
    expect(lines).toBeTruthy();
    expect((lines || []).some((line) => line.name === "Jeleva, Nephalia's Scourge")).toBe(true);
    expect((lines || []).some((line) => line.name === 'Sol Ring')).toBe(true);
    expect((lines || []).reduce((sum, line) => sum + (line.count || 1), 0)).toBe(100);
  });
});
