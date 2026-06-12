import { describe, expect, it } from 'vitest';
import {
  getBundledPreconDecklistLines,
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

  it('loads Commander 2015 Call the Spirits bundled decklist', () => {
    const lines = getBundledPreconDecklistLines('C15', 'Call the Spirits');
    expect(lines).toBeTruthy();
    expect((lines || []).length).toBeGreaterThan(70);
    expect((lines || []).some((line) => line.name === 'Sol Ring')).toBe(true);
    expect((lines || []).reduce((sum, line) => sum + (line.count || 1), 0)).toBeGreaterThanOrEqual(99);
  });
});
