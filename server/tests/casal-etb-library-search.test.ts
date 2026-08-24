import { describe, expect, it } from 'vitest';

import { detectTutorEffect, parseSearchCriteria } from '../src/socket/interaction.js';
import { filterLibraryCardsForSearch } from '../src/socket/library-search.js';
import { detectETBTriggers } from '../src/state/modules/triggered-abilities.js';

/**
 * Stack self-ETB + Oracle IR search_library owns Forest/battlefield tutors
 * (Solemn, Farhaven, Casal). finalizePlayedLand must not queue a second
 * LIBRARY_SEARCH. These tests assert the remaining generic pieces: ETB
 * detection, tutor criteria, and live-library subtype filtering.
 */

function forestTutorLibrary() {
  return [
    {
      id: 'forest_dual',
      name: 'Temple Garden',
      type_line: 'Land — Forest Plains',
      oracle_text: '',
      image_uris: { normal: 'forest.png' },
    },
    {
      id: 'plains_only',
      name: 'Plains',
      type_line: 'Basic Land — Plains',
      oracle_text: '',
      image_uris: { normal: 'plains.png' },
    },
  ];
}

function searchFilterFromOracle(oracleText: string) {
  const tutor = detectTutorEffect(oracleText);
  expect(tutor.isTutor).toBe(true);
  return parseSearchCriteria(String(tutor.searchCriteria || ''));
}

describe('generic ETB battlefield tutor search', () => {
  it('builds the ETB search from the live library snapshot using subtype filtering without relying on a specific card name', () => {
    const verdantGuideCard = {
      id: 'verdant_guide_card',
      name: 'Verdant Guide',
      type_line: 'Creature — Elf Scout',
      oracle_text: 'When Verdant Guide enters, search your library for a Forest card, put it onto the battlefield tapped, then shuffle.',
    };

    const triggers = detectETBTriggers(verdantGuideCard, { id: 'casal_perm', controller: 'p1' });
    expect(triggers.some((trigger) => /search your library/i.test(String(trigger.effect || trigger.description || '')))).toBe(true);

    const filter = searchFilterFromOracle(verdantGuideCard.oracle_text);
    expect(filter).toEqual({ subtypes: ['forest'] });
    expect(filterLibraryCardsForSearch(forestTutorLibrary(), filter).map((card) => card.id)).toEqual(['forest_dual']);
  });

  it('reads the front face ETB text for transform cards when top-level oracle text is absent', () => {
    const casalCard = {
      id: 'casal_card',
      name: 'Casal, Lurkwood Pathfinder // Casal, Pathbreaker Owlbear',
      type_line: 'Legendary Creature — Tiefling Druid // Legendary Creature — Bird Bear',
      layout: 'transform',
      card_faces: [
        {
          name: 'Casal, Lurkwood Pathfinder',
          type_line: 'Legendary Creature — Tiefling Druid',
          oracle_text: 'Vigilance\nWhen Casal enters, search your library for a Forest card, put it onto the battlefield tapped, then shuffle.',
        },
        {
          name: 'Casal, Pathbreaker Owlbear',
          type_line: 'Legendary Creature — Bird Bear',
          oracle_text: 'Vigilance, trample',
        },
      ],
    };

    const frontOracle = String(casalCard.card_faces[0].oracle_text);
    const cardForTriggers = { ...casalCard, oracle_text: frontOracle };
    const triggers = detectETBTriggers(cardForTriggers, {
      id: 'casal_perm',
      controller: 'p1',
      transformed: false,
      card: casalCard,
    });
    expect(triggers.some((trigger) => /search your library/i.test(String(trigger.effect || trigger.description || '')))).toBe(true);

    const filter = searchFilterFromOracle(frontOracle);
    expect(filterLibraryCardsForSearch(forestTutorLibrary(), filter).map((card) => card.id)).toEqual(['forest_dual']);
  });

  it('matches Forest subtypes case-insensitively when building the ETB tutor options', () => {
    const oracleText = 'When Casal enters, search your library for a Forest card, put it onto the battlefield tapped, then shuffle.';
    const filter = searchFilterFromOracle(oracleText);
    expect(filter).toEqual({ subtypes: ['forest'] });

    const library = [
      {
        id: 'forest_mixed_case',
        name: 'Temple Garden',
        type_line: 'Land — fOrEsT Plains',
        oracle_text: '',
        image_uris: { normal: 'forest.png' },
      },
      {
        id: 'plains_only_case_test',
        name: 'Plains',
        type_line: 'Basic Land — Plains',
        oracle_text: '',
        image_uris: { normal: 'plains.png' },
      },
    ];
    expect(filterLibraryCardsForSearch(library, filter).map((card) => card.id)).toEqual(['forest_mixed_case']);
  });
});
