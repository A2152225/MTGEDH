import { describe, expect, it } from 'vitest';
import {
  readHandCardToLibraryCount,
  readHandCardToLibraryPlacement,
} from '../src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerHandCardToLibraryPrompts.js';

describe('Brainstone-style N cards from hand to library prompts', () => {
  it('reads fixed count and top placement for two cards from hand', () => {
    const step = {
      kind: 'move_zone',
      what: { kind: 'raw', text: 'two cards from your hand' },
      to: 'library',
      toRaw: 'top of your library',
      raw: 'then put two cards from your hand on top of your library in any order',
    };
    expect(readHandCardToLibraryCount(step)).toBe(2);
    expect(readHandCardToLibraryPlacement(step)).toBe('top');
  });

  it('still treats a/an/one as a single-card choice', () => {
    const step = {
      kind: 'move_zone',
      what: { kind: 'raw', text: 'a card from your hand' },
      to: 'library',
      toRaw: 'bottom of your library',
      raw: 'put a card from your hand on the bottom of your library',
    };
    expect(readHandCardToLibraryCount(step)).toBe(1);
    expect(readHandCardToLibraryPlacement(step)).toBe('bottom');
  });
});
