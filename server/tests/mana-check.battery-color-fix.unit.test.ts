import { describe, expect, it } from 'vitest';

import {
  canPayManaCostWithAvailableSources,
  getAvailableMana,
  parseManaCost,
} from '../src/state/modules/mana-check.js';

const gemstoneOracle =
  '{2}: Put a charge counter on this artifact.\nRemove a charge counter from this artifact: Add one mana of any color.';

function emptyPool() {
  return { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
}

describe('mana-check mana-battery color fixing', () => {
  it('counts charged remove-counter any-color mana in getAvailableMana', () => {
    const state = {
      battlefield: [
        {
          id: 'gem_1',
          controller: 'p1',
          tapped: false,
          counters: { charge: 2 },
          card: {
            name: 'Gemstone Array',
            type_line: 'Artifact',
            oracle_text: gemstoneOracle,
          },
        },
      ],
      manaPool: { p1: emptyPool() },
    };

    const mana = getAvailableMana(state, 'p1');
    expect(mana.anyColor).toBe(2);
    expect(mana.red).toBe(2);
    expect(canPayManaCostWithAvailableSources(state, 'p1', parseManaCost('{R}{R}'))).toBe(true);
  });

  it('does not count empty remove-counter batteries as free mana', () => {
    const state = {
      battlefield: [
        {
          id: 'gem_1',
          controller: 'p1',
          tapped: false,
          counters: {},
          card: {
            name: 'Gemstone Array',
            type_line: 'Artifact',
            oracle_text: gemstoneOracle,
          },
        },
      ],
      manaPool: { p1: emptyPool() },
    };

    const mana = getAvailableMana(state, 'p1');
    expect(Number(mana.anyColor || 0)).toBe(0);
    expect(canPayManaCostWithAvailableSources(state, 'p1', parseManaCost('{R}'))).toBe(false);
  });

  it('can pay a missing color by charging a battery with spare mana (color fix)', () => {
    const state = {
      battlefield: [
        {
          id: 'forest_1',
          controller: 'p1',
          tapped: false,
          counters: {},
          card: {
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '{T}: Add {G}.',
          },
        },
        {
          id: 'forest_2',
          controller: 'p1',
          tapped: false,
          counters: {},
          card: {
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '{T}: Add {G}.',
          },
        },
        {
          id: 'gem_1',
          controller: 'p1',
          tapped: false,
          counters: {},
          card: {
            name: 'Gemstone Array',
            type_line: 'Artifact',
            oracle_text: gemstoneOracle,
          },
        },
      ],
      manaPool: { p1: emptyPool() },
    };

    expect(canPayManaCostWithAvailableSources(state, 'p1', parseManaCost('{R}'))).toBe(true);
    expect(canPayManaCostWithAvailableSources(state, 'p1', parseManaCost('{G}'))).toBe(true);
    // Net conversion spends 2 for 1 colored; cannot also keep both greens.
    expect(canPayManaCostWithAvailableSources(state, 'p1', parseManaCost('{G}{G}{R}'))).toBe(false);
  });

  it('can pay with floating spare mana and an empty battery color fix', () => {
    const state = {
      battlefield: [
        {
          id: 'gem_1',
          controller: 'p1',
          tapped: false,
          counters: {},
          card: {
            name: 'Gemstone Array',
            type_line: 'Artifact',
            oracle_text: gemstoneOracle,
          },
        },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 2, colorless: 0 },
      },
    };

    expect(canPayManaCostWithAvailableSources(state, 'p1', parseManaCost('{R}'))).toBe(true);
    expect(canPayManaCostWithAvailableSources(state, 'p1', parseManaCost('{U}'))).toBe(true);
  });

  it('gates Mirrodin\'s Core remove-for-any-color on charge counters for canPay', () => {
    const coreOracle =
      "{T}: Add {C}.\n{2}, {T}: Put a charge counter on Mirrodin's Core.\n{T}, Remove a charge counter from Mirrodin's Core: Add one mana of any color.";

    const empty = {
      battlefield: [
        {
          id: 'core_1',
          controller: 'p1',
          tapped: false,
          counters: {},
          card: {
            name: "Mirrodin's Core",
            type_line: 'Land',
            oracle_text: coreOracle,
          },
        },
      ],
      manaPool: { p1: emptyPool() },
    };

    expect(canPayManaCostWithAvailableSources(empty, 'p1', parseManaCost('{C}'))).toBe(true);
    expect(canPayManaCostWithAvailableSources(empty, 'p1', parseManaCost('{R}'))).toBe(false);

    const charged = {
      ...empty,
      battlefield: [
        {
          ...empty.battlefield[0],
          counters: { charge: 1 },
        },
      ],
    };
    expect(canPayManaCostWithAvailableSources(charged, 'p1', parseManaCost('{R}'))).toBe(true);
  });
});
