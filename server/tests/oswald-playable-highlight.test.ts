import { describe, expect, it } from 'vitest';
import {
  canPayManaCostWithAvailableSources,
  getAvailableMana,
  getTotalManaFromPool,
  parseManaCost,
} from '../src/state/modules/mana-check.js';
import { getCastableSpellCandidates } from '../src/state/modules/can-respond.js';

const playerId = 'p1';

function buildG1StyleState(options?: { allLandsTapped?: boolean }) {
  const tapped = options?.allLandsTapped === true;
  return {
    turnPlayer: playerId,
    priority: playerId,
    step: 'MAIN1',
    phase: 'precombatMain',
    stack: [],
    players: [{ id: playerId }],
    battlefield: [
      {
        id: 'wg',
        controller: playerId,
        tapped,
        card: {
          name: 'Watery Grave',
          type_line: 'Land — Island Swamp',
          oracle_text:
            '({T}: Add {U} or {B}.)\nAs Watery Grave enters the battlefield, you may pay 2 life. If you don\'t, it enters the battlefield tapped.',
        },
      },
      {
        id: 'p1',
        controller: playerId,
        tapped,
        card: { name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' },
      },
      {
        id: 'sf',
        controller: playerId,
        tapped,
        card: {
          name: 'Sacred Foundry',
          type_line: 'Land — Mountain Plains',
          oracle_text:
            '({T}: Add {R} or {W}.)\nAs Sacred Foundry enters the battlefield, you may pay 2 life. If you don\'t, it enters the battlefield tapped.',
        },
      },
      {
        id: 'p2',
        controller: playerId,
        tapped: true,
        card: { name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' },
      },
      {
        id: 'mr',
        controller: playerId,
        tapped,
        card: {
          name: 'Misty Rainforest',
          type_line: 'Land',
          oracle_text:
            '{T}, Pay 1 life, Sacrifice Misty Rainforest: Search your library for a Forest, Island, Swamp, or Plains card, put it onto the battlefield, then shuffle.',
        },
      },
      {
        id: 'inc',
        controller: playerId,
        tapped: false,
        card: {
          name: "Urza's Incubator",
          type_line: 'Artifact',
          oracle_text:
            'Artifact creature spells you cast cost {1} less to cast.\n{2}, {T}: You may put an artifact creature card from your hand onto the battlefield.',
        },
      },
    ],
    manaPool: {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
    zones: {
      [playerId]: {
        hand: [
          {
            id: 'oswald1',
            name: 'Oswald Fiddlebender',
            type_line: 'Legendary Creature — Gnome Artificer',
            mana_cost: '{1}{W}',
            oracle_text:
              'Magical Tinkering — {W}, {T}, Sacrifice an artifact: Search your library for an artifact card with mana value equal to 1 plus the sacrificed artifact\'s mana value, put it onto the battlefield, then shuffle. Activate only as a sorcery.',
          },
        ],
      },
    },
  };
}

describe('Oswald playable highlight (G1-style board)', () => {
  it('counts untapped mana and marks Oswald castable when lands are available', () => {
    const state = buildG1StyleState();
    const mana = getAvailableMana(state, playerId);

    expect(getTotalManaFromPool(mana)).toBeGreaterThan(0);
    expect(canPayManaCostWithAvailableSources(state, playerId, parseManaCost('{1}{W}'))).toBe(true);

    const candidates = getCastableSpellCandidates({ state, libraries: new Map() } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    });

    expect(candidates.some((candidate) => candidate.castCard?.name === 'Oswald Fiddlebender')).toBe(true);
  });

  it('does not mark Oswald castable when every mana source is tapped', () => {
    const state = buildG1StyleState({ allLandsTapped: true });
    const mana = getAvailableMana(state, playerId);

    expect(getTotalManaFromPool(mana)).toBe(0);
    expect(canPayManaCostWithAvailableSources(state, playerId, parseManaCost('{1}{W}'))).toBe(false);

    const candidates = getCastableSpellCandidates({ state, libraries: new Map() } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    });

    expect(candidates.some((candidate) => candidate.castCard?.name === 'Oswald Fiddlebender')).toBe(false);
  });
});
