import { describe, expect, it } from 'vitest';
import {
  canPayManaCostWithAvailableSources,
  getAvailableMana,
  getTotalManaFromPool,
  parseManaCost,
  stripReminderTextFromOracle,
} from '../src/state/modules/mana-check.js';
import { canCastAnySpell } from '../src/state/modules/can-respond.js';

describe('stripReminderTextFromOracle', () => {
  it('preserves parenthesized tap-for-mana abilities on shock lands', () => {
    const oracle =
      "({T}: Add {U} or {B}.)\nAs Watery Grave enters the battlefield, you may pay 2 life. If you don't, it enters the battlefield tapped.";

    expect(stripReminderTextFromOracle(oracle).toLowerCase()).toContain('{t}: add {u} or {b}');
  });
});

describe('shock land mana availability', () => {
  it('detects mana from shock lands for colored+generic costs', () => {
    const state = {
      battlefield: [
        {
          id: 'wg',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Watery Grave',
            type_line: 'Land — Island Swamp',
            oracle_text:
              "({T}: Add {U} or {B}.)\nAs Watery Grave enters the battlefield, you may pay 2 life. If you don't, it enters the battlefield tapped.",
          },
        },
        {
          id: 'plains',
          controller: 'p1',
          tapped: false,
          card: { name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' },
        },
        {
          id: 'sf',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Sacred Foundry',
            type_line: 'Land — Mountain Plains',
            oracle_text:
              "({T}: Add {R} or {W}.)\nAs Sacred Foundry enters the battlefield, you may pay 2 life. If you don't, it enters the battlefield tapped.",
          },
        },
      ],
      manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
    };

    const mana = getAvailableMana(state, 'p1');
    expect(getTotalManaFromPool(mana)).toBeGreaterThanOrEqual(3);
    expect(canPayManaCostWithAvailableSources(state, 'p1', parseManaCost('{1}{W}'))).toBe(true);
  });
});

describe('instant responses with shock lands (Gwafa / Swords scenario)', () => {
  const defender = 'p_rvmig2mz';
  const opponent = 'p_as3w7b5q';

  it('counts Swords as a response when Hallowed Fountain is untapped and creatures exist', () => {
    const state = {
      turnPlayer: opponent,
      priority: defender,
      step: 'MAIN1',
      phase: 'precombatMain',
      stack: [
        {
          id: 'gwafa_stack',
          controller: opponent,
          card: {
            name: 'Gwafa Hazid, Profiteer',
            type_line: 'Legendary Creature — Human Rogue',
          },
        },
      ],
      players: [{ id: defender }, { id: opponent }],
      battlefield: [
        {
          id: 'hf',
          controller: defender,
          tapped: false,
          card: {
            name: 'Hallowed Fountain',
            type_line: 'Land — Plains Island',
            oracle_text:
              "({T}: Add {W} or {U}.)\nAs Hallowed Fountain enters the battlefield, you may pay 2 life. If you don't, it enters the battlefield tapped.",
          },
        },
        {
          id: 'svyelun',
          controller: defender,
          tapped: false,
          card: {
            name: 'Svyelun of Sea and Sky',
            type_line: 'Legendary Creature — Merfolk God',
            power: '3',
            toughness: '4',
          },
        },
      ],
      manaPool: {
        [defender]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      zones: {
        [defender]: {
          hand: [
            {
              id: 'swords1',
              name: 'Swords to Plowshares',
              type_line: 'Instant',
              mana_cost: '{W}',
              oracle_text: 'Exile target creature. Its controller gains 3 life.',
            },
            {
              id: 'tutor1',
              name: 'Enlightened Tutor',
              type_line: 'Instant',
              mana_cost: '{W}',
              oracle_text: 'Search your library for an artifact or enchantment card, reveal it, put it into your hand, then shuffle.',
            },
          ],
        },
      },
      ignoredCardsForAutoPass: {
        [defender]: { tutor1: true },
      },
    };

    expect(canPayManaCostWithAvailableSources(state, defender, parseManaCost('{W}'))).toBe(true);
    expect(
      canCastAnySpell({ state, libraries: new Map() } as any, defender as any),
    ).toBe(true);
  });
});
