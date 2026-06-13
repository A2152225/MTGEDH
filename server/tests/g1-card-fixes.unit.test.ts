import { describe, expect, it } from 'vitest';

import { parseEtbOfferedCreatureTypes } from '../src/state/modules/chosen-creature-type.js';
import { requiresCreatureTypeSelection, getOfferedCreatureTypesForSelection } from '../src/socket/creature-type.js';
import { resolveManaAbilityActivationShape } from '../src/socket/interaction.js';
import { permanentHasSummoningSickness } from '../src/socket/game-actions.js';
import { sanitizeStepForClient } from '../src/socket/resolution.js';
import { ResolutionStepType } from '../src/state/resolution/index.js';
import { detectTapTriggers, collectTapTriggersForTapEvent } from '../src/state/modules/triggers/tap-untap.js';
import { getTapTriggers } from '../src/state/modules/triggered-abilities.js';
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

  it('resolves Path of Ancestry commander-restricted mana from imported commander colors field', () => {
    const oracle =
      'This land enters tapped.\n' +
      "{T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1.";

    const gameState = {
      commandZone: {
        p1: {
          commanderCards: [{ name: 'Adrix and Nev, Twincasters', colors: ['G', 'U'] }],
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

  it('resolves Path of Ancestry commander-restricted mana from commander mana cost when colors missing', () => {
    const oracle =
      'This land enters tapped.\n' +
      "{T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1.";

    const gameState = {
      commandZone: {
        p1: {
          commanderCards: [{ name: 'Adrix and Nev, Twincasters', mana_cost: '{2}{G}{U}' }],
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

  it('detects Deeproot Pilgrimage nontoken merfolk tap trigger', () => {
    const card = {
      name: 'Deeproot Pilgrimage',
      oracle_text:
        'Whenever one or more nontoken Merfolk you control become tapped, create a 1/1 blue Merfolk creature token with hexproof.',
    };
    const triggers = detectTapTriggers(card, { id: 'deeproot', controller: 'p1' });
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({
      tribalType: 'merfolk',
      nontokenOnly: true,
      mandatory: true,
    });
  });

  it('does not fire Deeproot Pilgrimage when a token merfolk is tapped', () => {
    const ctx = {
      state: {
        battlefield: [
      {
        id: 'deeproot',
        controller: 'p1',
        card: {
          name: 'Deeproot Pilgrimage',
          type_line: 'Enchantment',
          oracle_text:
            'Whenever one or more nontoken Merfolk you control become tapped, create a 1/1 blue Merfolk creature token with hexproof.',
        },
      },
      {
        id: 'token_merfolk',
        controller: 'p1',
        isToken: true,
        card: {
          name: 'Merfolk Token',
          type_line: 'Creature — Merfolk',
        },
      },
        ],
      },
    };
    const tappedPermanent = ctx.state.battlefield[1];
    const triggers = getTapTriggers(ctx as any, tappedPermanent, 'p1');
    expect(triggers.some((trigger) => trigger.cardName === 'Deeproot Pilgrimage')).toBe(false);
  });

  it('fires Deeproot Pilgrimage when Roaming Throne with chosen Merfolk is tapped', () => {
    const throneOracle =
      'Ward {2}\n' +
      'As this creature enters, choose a creature type.\n' +
      'This creature is the chosen type in addition to its other types.\n' +
      'If a triggered ability of another creature you control of the chosen type triggers, it triggers an additional time.';

    const ctx = {
      state: {
        battlefield: [
          {
            id: 'deeproot',
            controller: 'p1',
            card: {
              name: 'Deeproot Pilgrimage',
              type_line: 'Enchantment',
              oracle_text:
                'Whenever one or more nontoken Merfolk you control become tapped, create a 1/1 blue Merfolk creature token with hexproof.',
            },
          },
          {
            id: 'roaming_throne',
            controller: 'p1',
            chosenCreatureType: 'Merfolk',
            card: {
              name: 'Roaming Throne',
              type_line: 'Artifact Creature — Golem',
              oracle_text: throneOracle,
            },
          },
        ],
      },
    };
    const tappedPermanent = ctx.state.battlefield[1];
    const triggers = getTapTriggers(ctx as any, tappedPermanent, 'p1');
    expect(triggers.some((trigger) => trigger.cardName === 'Deeproot Pilgrimage')).toBe(true);
  });

  it('does not count Cavern of Souls chosen type as intrinsic Merfolk for tribal tap triggers', () => {
    const ctx = {
      state: {
        battlefield: [
          {
            id: 'deeproot',
            controller: 'p1',
            card: {
              name: 'Deeproot Pilgrimage',
              type_line: 'Enchantment',
              oracle_text:
                'Whenever one or more nontoken Merfolk you control become tapped, create a 1/1 blue Merfolk creature token with hexproof.',
            },
          },
          {
            id: 'cavern',
            controller: 'p1',
            chosenCreatureType: 'Merfolk',
            card: {
              name: 'Cavern of Souls',
              type_line: 'Land',
              oracle_text:
                'As Cavern of Souls enters the battlefield, choose a creature type.\n' +
                'Each creature spell of the chosen type you cast can\'t be countered.',
            },
          },
        ],
      },
    };
    const tappedPermanent = ctx.state.battlefield[1];
    const triggers = getTapTriggers(ctx as any, tappedPermanent, 'p1');
    expect(triggers.some((trigger) => trigger.cardName === 'Deeproot Pilgrimage')).toBe(false);
  });

  it('batches Deeproot Pilgrimage to one trigger when multiple merfolk tap together', () => {
    const deeprootOracle =
      'Whenever one or more nontoken Merfolk you control become tapped, create a 1/1 blue Merfolk creature token with hexproof.';
    const ctx = {
      state: {
        battlefield: [
          {
            id: 'deeproot',
            controller: 'p1',
            card: {
              name: 'Deeproot Pilgrimage',
              type_line: 'Enchantment',
              oracle_text: deeprootOracle,
            },
          },
          {
            id: 'merfolk_1',
            controller: 'p1',
            card: { name: 'Merfolk Looter', type_line: 'Creature — Merfolk' },
          },
          {
            id: 'merfolk_2',
            controller: 'p1',
            card: { name: 'Master of the Pearl Trident', type_line: 'Creature — Merfolk' },
          },
          {
            id: 'merfolk_3',
            controller: 'p1',
            card: { name: 'Lord of Atlantis', type_line: 'Creature — Merfolk' },
          },
        ],
      },
    };

    const entries = collectTapTriggersForTapEvent(ctx as any, ['merfolk_1', 'merfolk_2', 'merfolk_3'], 'p1');
    const deeprootEntries = entries.filter((entry) => entry.trigger.cardName === 'Deeproot Pilgrimage');
    expect(deeprootEntries).toHaveLength(1);
    expect(deeprootEntries[0].trigger.oneOrMoreBatch).toBe(true);
  });

  it('still fires Deeproot Pilgrimage separately for distinct tap events', () => {
    const deeprootOracle =
      'Whenever one or more nontoken Merfolk you control become tapped, create a 1/1 blue Merfolk creature token with hexproof.';
    const ctx = {
      state: {
        battlefield: [
          {
            id: 'deeproot',
            controller: 'p1',
            card: {
              name: 'Deeproot Pilgrimage',
              type_line: 'Enchantment',
              oracle_text: deeprootOracle,
            },
          },
          {
            id: 'merfolk_1',
            controller: 'p1',
            card: { name: 'Merfolk Looter', type_line: 'Creature — Merfolk' },
          },
          {
            id: 'merfolk_2',
            controller: 'p1',
            card: { name: 'Master of the Pearl Trident', type_line: 'Creature — Merfolk' },
          },
        ],
      },
    };

    const firstEvent = collectTapTriggersForTapEvent(ctx as any, ['merfolk_1'], 'p1');
    const secondEvent = collectTapTriggersForTapEvent(ctx as any, ['merfolk_2'], 'p1');
    expect(firstEvent.filter((entry) => entry.trigger.cardName === 'Deeproot Pilgrimage')).toHaveLength(1);
    expect(secondEvent.filter((entry) => entry.trigger.cardName === 'Deeproot Pilgrimage')).toHaveLength(1);
  });

  it('treats enteredThisTurn as summoning sickness until cleared', () => {
    const creature = {
      id: 'svyelun',
      controller: 'p1',
      enteredThisTurn: true,
      card: {
        name: 'Svyelun of Sea and Sky',
        type_line: 'Legendary Creature — Merfolk God',
        oracle_text: 'Svyelun has indestructible.',
      },
    };
    expect(permanentHasSummoningSickness(creature, [creature], 'p1')).toBe(true);
  });

  it('preserves offeredCreatureTypes on creature type choice steps sent to client', () => {
    const offered = ['Elemental', 'Elf', 'Merfolk'];
    const sanitized = sanitizeStepForClient('game_test', {
      id: 'step_creature_type',
      type: ResolutionStepType.CREATURE_TYPE_CHOICE,
      gameId: 'game_test',
      permanentId: 'eclipsed_realms_1',
      cardName: 'Eclipsed Realms',
      reason: 'Choose one: Elemental, Elf, Merfolk',
      offeredCreatureTypes: offered,
    } as any);
    expect(sanitized.offeredCreatureTypes).toEqual(offered);
  });
});
