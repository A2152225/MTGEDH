import { describe, expect, it } from 'vitest';

import { parseEtbOfferedCreatureTypes } from '../src/state/modules/chosen-creature-type.js';
import { requiresCreatureTypeSelection, getOfferedCreatureTypesForSelection } from '../src/socket/creature-type.js';
import { resolveManaAbilityActivationShape } from '../src/socket/interaction.js';
import { detectTapTriggers } from '../src/state/modules/triggers/tap-untap.js';
import { detectKeywords } from '../src/state/modules/keyword-detection.js';

describe('G1 card regression helpers', () => {
  it('parses Eclipsed Realms finite creature type ETB list', () => {
    const oracle =
      'As this land enters, choose Elemental, Elf, Faerie, Giant, Goblin, Kithkin, Merfolk, or Treefolk.\n' +
      '{T}: Add {C}.\n' +
      '{T}: Add one mana of any color. Spend this mana only to cast a spell of the chosen type or activate an ability of a source of the chosen type.';

    const offered = parseEtbOfferedCreatureTypes(oracle);
    expect(offered).toEqual([
      'Elemental',
      'Elf',
      'Faerie',
      'Giant',
      'Goblin',
      'Kithkin',
      'Merfolk',
      'Treefolk',
    ]);

    const card = { name: 'Eclipsed Realms', oracle_text: oracle };
    expect(requiresCreatureTypeSelection(card)).toEqual({
      required: true,
      reason: 'Choose one: Elemental, Elf, Faerie, Giant, Goblin, Kithkin, Merfolk, Treefolk',
    });
    expect(getOfferedCreatureTypesForSelection(card)).toEqual(offered);
  });

  it('resolves Path of Ancestry commander-restricted mana into choosable colors', () => {
    const oracle =
      'This land enters tapped.\n' +
      "{T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1.";

    const gameState = {
      commandZone: {
        p1: {
          commanderCards: [{ color_identity: ['U', 'G'] }],
        },
      },
      battlefield: [],
    };
    const permanent = {
      id: 'path_perm',
      card: { name: 'Path of Ancestry', type_line: 'Land', oracle_text: oracle },
    };

    const shape = resolveManaAbilityActivationShape(
      gameState,
      permanent,
      'p1',
      'path-ability-0',
      "{T}: Add one mana of any color in your commander's color identity.",
      "Add one mana of any color in your commander's color identity.",
      '{T}',
    );

    expect(shape.produces.sort()).toEqual(['G', 'U']);
  });

  it('does not treat Path of Ancestry mana-spend scry rider as an ETB scry keyword', () => {
    const oracle =
      'This land enters tapped.\n' +
      "{T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1.";

    const keywords = detectKeywords(oracle, 'Path of Ancestry').keywords;
    expect(keywords.some((entry) => entry.keyword === 'scry')).toBe(false);
  });

  it('treats Surgespanner tap trigger as mandatory with optional pay rider', () => {
    const card = {
      name: 'Surgespanner',
      oracle_text:
        "Whenever this creature becomes tapped, you may pay {1}{U}. If you do, return target permanent to its owner's hand.",
    };
    const triggers = detectTapTriggers(card, { id: 'surge', controller: 'p1' });
    expect(triggers).toHaveLength(1);
    expect(triggers[0].mandatory).toBe(true);
  });
});
