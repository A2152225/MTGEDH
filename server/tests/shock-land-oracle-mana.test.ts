import { describe, expect, it } from 'vitest';
import {
  canPayManaCostWithAvailableSources,
  getAvailableMana,
  getTotalManaFromPool,
  parseManaCost,
  stripReminderTextFromOracle,
} from '../src/state/modules/mana-check.js';

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
