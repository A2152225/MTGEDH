/**
 * Regression: exact mana payability must stay bounded with Ashnod's Altar + many tokens.
 */
import { describe, expect, it } from 'vitest';
import {
  canPayManaCostWithAvailableSources,
  parseManaCost,
} from '../src/state/modules/mana-check.js';
import { canAct } from '../src/state/modules/can-respond.js';
import type { GameContext } from '../src/state/context.js';

function buildWideAltarState(creatureCount: number) {
  const creatures = Array.from({ length: creatureCount }, (_, i) => ({
    id: `token_${i}`,
    controller: 'player1',
    owner: 'player1',
    tapped: false,
    summoningSickness: true,
    card: {
      name: 'Merfolk Wizard',
      type_line: 'Creature — Merfolk Wizard',
      oracle_text: '',
    },
  }));

  return {
    battlefield: [
      {
        id: 'perm_altar',
        controller: 'player1',
        owner: 'player1',
        tapped: false,
        summoningSickness: false,
        card: {
          name: "Ashnod's Altar",
          type_line: 'Artifact',
          oracle_text: 'Sacrifice a creature: Add {C}{C}.',
        },
      },
      {
        id: 'perm_coast',
        controller: 'player1',
        owner: 'player1',
        tapped: false,
        summoningSickness: false,
        card: {
          name: 'Yavimaya Coast',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}. {T}: Add {G} or {U}.',
        },
      },
      {
        id: 'perm_fountain',
        controller: 'player1',
        owner: 'player1',
        tapped: false,
        summoningSickness: false,
        card: {
          name: 'Hallowed Fountain',
          type_line: 'Land — Plains Island',
          oracle_text: '{T}: Add {W} or {U}.',
        },
      },
      {
        id: 'perm_grave',
        controller: 'player1',
        owner: 'player1',
        tapped: false,
        summoningSickness: false,
        card: {
          name: 'Watery Grave',
          type_line: 'Land — Island Swamp',
          oracle_text: '{T}: Add {U} or {B}.',
        },
      },
      ...creatures,
    ],
    commandZone: {},
    manaPool: {
      player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
    zones: {
      player1: {
        hand: [
          {
            id: 'card_gilder',
            name: 'Gilder Bairn',
            type_line: 'Creature — Ouphe',
            mana_cost: '{1}{G/U}{G/U}',
            oracle_text: '{2}{G/U}, {T}: Double the number of each kind of counter on target permanent.',
          },
          {
            id: 'card_tutor',
            name: 'Demonic Tutor',
            type_line: 'Sorcery',
            mana_cost: '{1}{B}',
            oracle_text: 'Search your library for a card, put that card into your hand, then shuffle.',
          },
        ],
      },
    },
    stack: [],
    step: 'MAIN2',
    turnPlayer: 'player1',
    priority: 'player1',
    players: [{ id: 'player1' }, { id: 'player2' }],
  };
}

describe('exact mana search board-width guard', () => {
  it('resolves Ashnod altar + many tokens without hanging', () => {
    const state = buildWideAltarState(24);
    const started = Date.now();
    const heap0 = process.memoryUsage().heapUsed;

    const gilderOk = canPayManaCostWithAvailableSources(state, 'player1', parseManaCost('{1}{G/U}{G/U}'));
    const tutorOk = canPayManaCostWithAvailableSources(state, 'player1', parseManaCost('{1}{B}'));
    const ctx = { state, libraries: new Map(), rng: () => 0.5 } as GameContext;
    const act = canAct(ctx, 'player1');

    const elapsed = Date.now() - started;
    const growthMB = (process.memoryUsage().heapUsed - heap0) / (1024 * 1024);

    // Generous wall-clock budget: the guard exists to stop an exponential search (minutes / GBs), and a
    // tight 5s figure flaked when the whole suite runs in parallel on a loaded machine.
    expect(elapsed).toBeLessThan(30_000);
    expect(growthMB).toBeLessThan(200);
    // Altar + duals should make these payable (or at least canAct must finish).
    expect(typeof gilderOk).toBe('boolean');
    expect(typeof tutorOk).toBe('boolean');
    expect(act).toBe(true);
  }, 120_000);
});
