import { describe, expect, it } from 'vitest';
import { librarySearchForcedSelectionIds, librarySearchSelectionResetKey } from '../src/components/librarySearchSelectionKey';

describe('librarySearchSelectionResetKey', () => {
  it('is stable for a re-sent prompt with rebuilt card arrays', () => {
    const first = [{ id: 'lib_2', name: 'Bear' }];
    const resent = [{ id: 'lib_2', name: 'Bear' }];
    expect(first).not.toBe(resent);
    expect(librarySearchSelectionResetKey(resent)).toBe(librarySearchSelectionResetKey(first));
  });

  it('changes when the offered cards change', () => {
    expect(librarySearchSelectionResetKey([{ id: 'a' }])).not.toBe(librarySearchSelectionResetKey([{ id: 'b' }]));
    expect(librarySearchSelectionResetKey([{ id: 'a' }])).not.toBe(librarySearchSelectionResetKey([{ id: 'a' }, { id: 'b' }]));
    expect(librarySearchSelectionResetKey([])).toBe('');
  });
});

describe('librarySearchForcedSelectionIds', () => {
  it('pre-selects the only legal pick of a mandatory choice (reveal-until hit)', () => {
    expect(librarySearchForcedSelectionIds({ cards: [{ id: 'lib_2' }], minSelections: 1, mandatory: true })).toEqual(['lib_2']);
  });

  it('leaves real choices and optional/split/mana-capped prompts alone', () => {
    expect(librarySearchForcedSelectionIds({ cards: [{ id: 'a' }, { id: 'b' }], minSelections: 1, mandatory: true })).toEqual([]);
    expect(librarySearchForcedSelectionIds({ cards: [{ id: 'a' }], minSelections: 1, mandatory: false })).toEqual([]);
    expect(librarySearchForcedSelectionIds({ cards: [{ id: 'a' }], minSelections: 0, mandatory: true })).toEqual([]);
    expect(librarySearchForcedSelectionIds({ cards: [{ id: 'a' }], minSelections: 1, mandatory: true, splitDestination: true })).toEqual([]);
    expect(librarySearchForcedSelectionIds({ cards: [{ id: 'a' }], minSelections: 1, mandatory: true, maxTotalManaValue: 3 })).toEqual([]);
  });
});