import { describe, expect, it } from 'vitest';
import { colorChoiceStepColorWords, normalizeColorChoiceWord } from '../src/socket/colorChoiceSelection.js';
import { parseSearchCriteria } from '../src/socket/interaction-handlers/interactionTutorSearchCriteriaParsing.js';
import { filterLibraryCardsForSearch } from '../src/socket/library-search.js';

describe('outcome sweep round 2 engine fixes', () => {
  it('compares COLOR_CHOICE answers as color words for option objects and letters', () => {
    const colors = [{ id: 'W', label: 'White' }, { id: 'U', label: 'Blue' }];
    expect(colorChoiceStepColorWords(colors)).toEqual(['white', 'blue']);
    expect(normalizeColorChoiceWord('white')).toBe('white');
    expect(normalizeColorChoiceWord('W')).toBe('white');
    expect(normalizeColorChoiceWord('{U}')).toBe('blue');
    expect(normalizeColorChoiceWord('purple')).toBeUndefined();
    expect(colorChoiceStepColorWords(undefined)).toHaveLength(5);
  });

  it('parses "basic land cards and/or Gate cards" as a disjunction (Navigation Orb)', () => {
    const filter: any = parseSearchCriteria('basic land cards and/or gate cards');
    expect(filter.anyOf).toHaveLength(2);
    const library = [
      { id: 'plains', name: 'Plains', type_line: 'Basic Land — Plains' },
      { id: 'gate', name: 'Azorius Guildgate', type_line: 'Land — Gate' },
      { id: 'tundra', name: 'Tundra', type_line: 'Land — Plains Island' },
      { id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
    ];
    expect(filterLibraryCardsForSearch(library, filter).map((card: any) => card.id)).toEqual(['plains', 'gate']);
    // Single-noun "or" lists keep their existing conjunctive shape.
    expect(parseSearchCriteria('an artifact or enchantment card')).toEqual({ types: ['artifact', 'enchantment'] });
  });
});
