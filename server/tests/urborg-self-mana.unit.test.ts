/**
 * Urborg / Yavimaya grant a basic land type to every land, including themselves.
 * The source has no printed "{T}: Add"; spendable mana is the intrinsic ability
 * from that type (CR 305.6). A filter that skips the source permanent fails these.
 */

import { describe, expect, it } from 'vitest';
import { getManaAbilitiesForPermanent, getEffectiveBasicLandTypes } from '../src/state/modules/mana-abilities';
import {
  canPayManaCostWithAvailableSources,
  getAvailableMana,
  getTotalManaFromPool,
  parseManaCost,
} from '../src/state/modules/mana-check.js';
import { calculateManaProduction } from '../src/socket/util.js';

const URBORG_ORACLE = 'Each land is a Swamp in addition to its other land types.';
const YAVIMAYA_ORACLE = 'Each land is a Forest in addition to its other land types.';

function land(id: string, name: string, typeLine: string, oracleText: string) {
  return {
    id,
    controller: 'player1',
    tapped: false,
    card: {
      name,
      type_line: typeLine,
      oracle_text: oracleText,
    },
  };
}

function stateWith(...battlefield: any[]) {
  return {
    battlefield,
    manaPool: {
      player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
  };
}

describe('source land includes itself in each-land type grants', () => {
  it('counts untapped Urborg as one black mana', () => {
    const urborg = land(
      'urborg_1',
      'Urborg, Tomb of Yawgmoth',
      'Legendary Land',
      URBORG_ORACLE,
    );
    const gameState = stateWith(urborg);

    expect(getEffectiveBasicLandTypes(gameState, urborg)).toEqual(['swamp']);
    expect(getManaAbilitiesForPermanent(gameState, urborg, 'player1').some((ability) => ability.produces.includes('B'))).toBe(true);

    const produced = calculateManaProduction(gameState, urborg, 'player1', 'B');
    expect(produced.colors.map((color) => String(color).toUpperCase())).toContain('B');

    const mana = getAvailableMana(gameState, 'player1');
    expect(mana.black).toBe(1);
    expect(getTotalManaFromPool(mana)).toBe(1);
    expect(canPayManaCostWithAvailableSources(gameState, 'player1', parseManaCost('{B}'))).toBe(true);
    expect(canPayManaCostWithAvailableSources(gameState, 'player1', parseManaCost('{G}'))).toBe(false);
  });

  it('counts untapped Yavimaya as one green mana', () => {
    const yavimaya = land(
      'yavimaya_1',
      'Yavimaya, Cradle of Growth',
      'Legendary Land',
      YAVIMAYA_ORACLE,
    );
    const gameState = stateWith(yavimaya);

    expect(getEffectiveBasicLandTypes(gameState, yavimaya)).toEqual(['forest']);
    const mana = getAvailableMana(gameState, 'player1');
    expect(mana.green).toBe(1);
    expect(getTotalManaFromPool(mana)).toBe(1);
  });

  it('still makes other lands Swamps and keeps Urborg as a second black source', () => {
    const urborg = land(
      'urborg_1',
      'Urborg, Tomb of Yawgmoth',
      'Legendary Land',
      URBORG_ORACLE,
    );
    const plains = land('plains_1', 'Plains', 'Basic Land — Plains', '{T}: Add {W}.');
    const gameState = stateWith(urborg, plains);

    expect(getEffectiveBasicLandTypes(gameState, plains)).toEqual(['plains', 'swamp']);
    expect(getEffectiveBasicLandTypes(gameState, urborg)).toEqual(['swamp']);

    const plainsAbilities = getManaAbilitiesForPermanent(gameState, plains, 'player1');
    expect(plainsAbilities.some((ability) => ability.produces.includes('W'))).toBe(true);
    expect(plainsAbilities.some((ability) => ability.produces.includes('B'))).toBe(true);

    const mana = getAvailableMana(gameState, 'player1');
    expect(mana.white).toBe(1);
    expect(mana.black).toBe(2);
    expect(getTotalManaFromPool(mana)).toBe(2);
    expect(canPayManaCostWithAvailableSources(gameState, 'player1', parseManaCost('{W}{B}'))).toBe(true);
    expect(canPayManaCostWithAvailableSources(gameState, 'player1', parseManaCost('{B}{B}'))).toBe(true);
    expect(canPayManaCostWithAvailableSources(gameState, 'player1', parseManaCost('{W}{W}'))).toBe(false);
  });

  it('pays black from Urborg when an activation-cost rock forces exact sources', () => {
    const urborg = land(
      'urborg_1',
      'Urborg, Tomb of Yawgmoth',
      'Legendary Land',
      URBORG_ORACLE,
    );
    const signet = land(
      'signet_1',
      'Izzet Signet',
      'Artifact',
      '{1}, {T}: Add {U}{R}.',
    );
    const mountain = land('mountain_1', 'Mountain', 'Basic Land — Mountain', '{T}: Add {R}.');
    const gameState = stateWith(urborg, signet, mountain);

    expect(canPayManaCostWithAvailableSources(gameState, 'player1', parseManaCost('{B}{B}'))).toBe(true);
    expect(canPayManaCostWithAvailableSources(gameState, 'player1', parseManaCost('{R}{B}'))).toBe(true);
  });

  it('does not let an enchantment each-land effect produce mana from itself', () => {
    const blanket = {
      id: 'blanket_1',
      controller: 'player1',
      tapped: false,
      card: {
        name: 'Blanket of Night',
        type_line: 'Enchantment',
        oracle_text: URBORG_ORACLE,
      },
    };
    const mountain = land('mountain_1', 'Mountain', 'Basic Land — Mountain', '{T}: Add {R}.');
    const gameState = stateWith(blanket, mountain);

    const mana = getAvailableMana(gameState, 'player1');
    expect(mana.red).toBe(1);
    expect(mana.black).toBe(1);
    expect(getTotalManaFromPool(mana)).toBe(1);
    expect(getManaAbilitiesForPermanent(gameState, blanket, 'player1')).toEqual([]);
  });
});
