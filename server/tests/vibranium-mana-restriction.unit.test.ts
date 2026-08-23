import { describe, expect, it } from 'vitest';

import { parseManaSpendRestrictionFromOracle } from '../src/state/modules/mana-abilities.js';
import { canPayManaCostWithAvailableSources } from '../src/state/modules/mana-check.js';

describe('Vibranium / Powerstone mana spend restriction', () => {
  const vibraniumOracle =
    "{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.";

  it('parses no_nonartifact_spells from Vibranium oracle text', () => {
    expect(parseManaSpendRestrictionFromOracle(vibraniumOracle)).toEqual({
      restriction: 'no_nonartifact_spells',
    });
  });

  it('does not count Vibranium toward casting Generous Gift (nonartifact instant)', () => {
    const generousGift = {
      name: 'Generous Gift',
      type_line: 'Instant',
      mana_cost: '{2}{W}',
      oracle_text: 'Destroy target permanent. Its controller creates a 3/3 green Elephant creature token.',
    };

    const state = {
      battlefield: [
        {
          id: 'vib-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Vibranium',
            type_line: 'Token Artifact - Vibranium',
            oracle_text: vibraniumOracle,
          },
        },
        {
          id: 'plains-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Plains',
            type_line: 'Basic Land - Plains',
            oracle_text: '{T}: Add {W}.',
          },
        },
      ],
      manaPool: {
        player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      zones: {
        player1: { hand: [], libraryCount: 0, graveyard: [], exile: [] },
      },
    };

    const canPay = canPayManaCostWithAvailableSources(
      state,
      'player1',
      { colors: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 }, generic: 2, hasX: false },
      Infinity,
      {
        restrictedSpendPurpose: {
          isCreature: false,
          isArtifact: false,
          isInstantOrSorcery: true,
          spellCard: generousGift,
        },
      },
    );

    expect(canPay).toBe(false);
  });

  it('allows Vibranium toward an artifact spell when other mana covers colors', () => {
    const solRing = {
      name: 'Sol Ring',
      type_line: 'Artifact',
      mana_cost: '{1}',
      oracle_text: '{T}: Add {C}{C}.',
    };

    const state = {
      battlefield: [
        {
          id: 'vib-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Vibranium',
            type_line: 'Token Artifact - Vibranium',
            oracle_text: vibraniumOracle,
          },
        },
      ],
      manaPool: {
        player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      zones: {
        player1: { hand: [], libraryCount: 0, graveyard: [], exile: [] },
      },
    };

    const canPay = canPayManaCostWithAvailableSources(
      state,
      'player1',
      { colors: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 }, generic: 1, hasX: false },
      Infinity,
      {
        restrictedSpendPurpose: {
          isArtifact: true,
          spellCard: solRing,
        },
      },
    );

    expect(canPay).toBe(true);
  });
  it('allows Vibranium toward an Artifact Vehicle spell (not only Artifact Creature)', () => {
    const royalTalon = {
      name: 'Royal Talon Fighter Jet',
      type_line: 'Artifact - Vehicle',
      mana_cost: '{X}{W}{W}',
      oracle_text: 'Flying',
    };

    const state = {
      battlefield: [
        {
          id: 'vib-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Vibranium',
            type_line: 'Token Artifact - Vibranium',
            oracle_text: vibraniumOracle,
          },
        },
        {
          id: 'plains-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Plains',
            type_line: 'Basic Land - Plains',
            oracle_text: '{T}: Add {W}.',
          },
        },
        {
          id: 'plains-2',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Plains',
            type_line: 'Basic Land - Plains',
            oracle_text: '{T}: Add {W}.',
          },
        },
      ],
      manaPool: {
        player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      zones: {
        player1: { hand: [], libraryCount: 0, graveyard: [], exile: [] },
      },
    };

    const canPay = canPayManaCostWithAvailableSources(
      state,
      'player1',
      { colors: { white: 2, blue: 0, black: 0, red: 0, green: 0, colorless: 0 }, generic: 1, hasX: false },
      Infinity,
      {
        restrictedSpendPurpose: {
          isArtifact: true,
          spellCard: royalTalon,
        },
      },
    );

    expect(canPay).toBe(true);
  });

});
