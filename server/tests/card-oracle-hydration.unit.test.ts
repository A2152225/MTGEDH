import { describe, expect, it } from 'vitest';

import {
  cardShouldHydrateOracleText,
  hydratePermanentCardOracle,
  mergeOracleFieldsFromLookup,
} from '../../shared/src/hydrateCardOracleText.js';
import { stripLegendaryFromTypeLine } from '../../shared/src/copyTokenUtils.js';
import {
  parseCopyTokenOverridesFromEffect,
  type CopyTokenOverrides,
} from '../../shared/src/copyTokenOverrides.js';
import { hydrateGameStateOracleText, hydratePermanentCardOracleInPlace } from '../src/state/modules/cardOracleHydration.js';

const ZULAPORT_ORACLE =
  'Whenever Zulaport Cutthroat or another creature you control dies, each opponent loses 1 life and you gain 1 life.';

describe('hydrateCardOracleText', () => {
  it('skips tokens and fully populated cards, but repairs thin stubs that lost cast fields', () => {
    expect(
      cardShouldHydrateOracleText(
        { name: 'Soldier', type_line: 'Token Creature — Soldier', oracle_text: '' },
        { isToken: true },
      ),
    ).toBe(false);
    // oracle_text alone is not enough — missing mana_cost / type_line still hydrates.
    expect(
      cardShouldHydrateOracleText({
        name: 'Lightning Bolt',
        oracle_text: 'Deal 3 damage.',
      }),
    ).toBe(true);
    expect(
      cardShouldHydrateOracleText({
        name: 'Lightning Bolt',
        oracle_text: 'Deal 3 damage.',
        type_line: 'Instant',
        mana_cost: '{R}',
      }),
    ).toBe(false);
  });

  it('skips prototype tokens but hydrates printed-card copy tokens', () => {
    const soldier = {
      isToken: true,
      card: {
        name: 'Soldier',
        type_line: 'Token Creature — Soldier',
        oracle_text: '',
      },
    };
    expect(hydratePermanentCardOracle(soldier, () => ({
      oracle_text: 'Should not apply',
    }))).toBe(false);

    const humanSoldier = {
      isToken: true,
      card: {
        name: 'Human Soldier',
        type_line: 'Creature — Human Soldier',
        power: '1',
        toughness: '1',
        oracle_text: '',
      },
    };
    expect(
      hydratePermanentCardOracle(humanSoldier, () => ({
        oracle_text: 'Training\nWhenever this creature attacks with another creature with greater power, put a +1/+1 counter on this creature.',
        type_line: 'Creature — Human Soldier',
      })),
    ).toBe(false);
    expect(String(humanSoldier.card.oracle_text || '')).toBe('');

    const copy = {
      isToken: true,
      isCopyToken: true,
      card: {
        name: 'Zulaport Cutthroat',
        type_line: 'Creature — Human Rogue Ally',
        power: '1',
        toughness: '1',
      },
    };
    expect(
      hydratePermanentCardOracle(copy, (name) =>
        name.toLowerCase() === 'zulaport cutthroat'
          ? { oracle_text: ZULAPORT_ORACLE, type_line: 'Creature — Human Rogue Ally' }
          : undefined,
      ),
    ).toBe(true);
    expect(copy.card.oracle_text).toBe(ZULAPORT_ORACLE);
  });

  it('hydrates printed-card oracle onto battlefield permanents by name', () => {
    const permanent = {
      id: 'perm_1',
      card: {
        id: 'card_1',
        name: 'Zulaport Cutthroat',
        type_line: 'Creature — Human Rogue Ally',
        power: '1',
        toughness: '1',
      },
    };

    const hydrated = hydratePermanentCardOracle(permanent, (name) =>
      name.toLowerCase() === 'zulaport cutthroat'
        ? {
            oracle_text: ZULAPORT_ORACLE,
            type_line: 'Creature — Human Rogue Ally',
            power: '1',
            toughness: '1',
          }
        : undefined,
    );

    expect(hydrated).toBe(true);
    expect(permanent.card.oracle_text).toBe(ZULAPORT_ORACLE);
  });

  it('mergeOracleFieldsFromLookup only fills missing fields', () => {
    const card: Record<string, unknown> = {
      name: 'Zulaport Cutthroat',
      type_line: 'Creature — Human Rogue Ally',
      power: '1',
      toughness: '1',
    };

    expect(
      mergeOracleFieldsFromLookup(card, () => ({
        oracle_text: ZULAPORT_ORACLE,
        type_line: 'Creature',
        power: '2',
        toughness: '2',
      })),
    ).toBe(true);

    expect(card.oracle_text).toBe(ZULAPORT_ORACLE);
    expect(card.type_line).toBe('Creature — Human Rogue Ally');
    expect(card.power).toBe('1');
    expect(card.toughness).toBe('1');
  });

  it('hydrates oracle text across battlefield, stack, and zones', () => {
    const state = {
      battlefield: [
        {
          id: 'perm_1',
          card: { name: 'Zulaport Cutthroat', type_line: 'Creature' },
        },
      ],
      stack: [{ card: { name: 'Lightning Bolt' } }],
      zones: {
        p1: {
          hand: [{ name: 'Sol Ring' }],
          graveyard: [{ name: 'Zulaport Cutthroat' }],
          exile: [],
        },
      },
    };

    const libraries = new Map([
      ['p1', [{ name: 'Rampant Growth' }]],
    ]);
    hydrateGameStateOracleText(state, libraries);

    expect(String(state.battlefield[0].card.oracle_text || '')).toContain('dies');
    expect(String(state.stack[0].card.oracle_text || '')).toContain('damage');
    expect(String(state.zones.p1.hand[0].oracle_text || '')).toContain('Add');
    expect(String(state.zones.p1.graveyard[0].oracle_text || '')).toContain('dies');
    expect(String(libraries.get('p1')?.[0]?.oracle_text || '').toLowerCase()).toContain('search');
  });

  it('keeps Helm copies nonlegendary after hydration lookup', () => {
    const helmOracle =
      "At the beginning of combat on your turn, create a token that's a copy of equipped creature, except the token isn't legendary. That token gains haste.\nEquip {5}";
    const overrides = parseCopyTokenOverridesFromEffect(helmOracle);
    expect(overrides.removeLegendary).toBe(true);
    expect((overrides.addAbilities || []).map((a) => a.toLowerCase())).toContain('haste');

    const permanent = {
      isToken: true,
      isCopyToken: true,
      copyTokenOverrides: overrides,
      type_line: 'Legendary Creature — Human Rogue Ally',
      cardType: 'Legendary Creature — Human Rogue Ally',
      card: {
        name: 'Zulaport Cutthroat',
        type_line: 'Legendary Creature — Human Rogue Ally',
      },
    };

    hydratePermanentCardOracleInPlace(permanent);
    expect(String(permanent.card.type_line || '').toLowerCase()).not.toContain('legendary');
    expect(stripLegendaryFromTypeLine('Legendary Creature — Human Rogue Ally')).toBe('Creature — Human Rogue Ally');
  });

  it('parses shorthand not-legendary copy exceptions', () => {
    const overrides = parseCopyTokenOverridesFromEffect(
      "Create a token that's a copy of equipped creature, except it's not legendary and has haste",
    );
    expect(overrides.removeLegendary).toBe(true);
    expect((overrides.addAbilities || []).map((a) => a.toLowerCase())).toContain('haste');
  });

  it('documents that prototype tokens intentionally skip oracle hydration', () => {
    const soldier = {
      isToken: true,
      card: {
        name: 'Soldier',
        type_line: 'Token Creature — Soldier',
        power: '1',
        toughness: '1',
        colors: ['W'],
        oracle_text: '',
      },
    };

    hydratePermanentCardOracleInPlace(soldier);
    expect(String(soldier.card.oracle_text || '')).toBe('');
    expect(soldier.card.type_line).toContain('Token Creature');
  });
});
