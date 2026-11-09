/**
 * Information-leak test (P0-2).
 *
 * Check 1 (strong): buildObservation deep-equals for a state and a twin with
 * swapped opponent hands/libraries and a reordered own library.
 * Check 2 (behavioural): enumerateAIActionCandidates returns the same ranked
 * actions on both states (covers reads that bypass Observation until Phase 1).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildObservation } from '../../rules-engine/src/ai/buildObservation.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { cleanupGameAI, registerAIPlayer } from '../src/socket/ai.js';
import { enumerateAIActionCandidates } from '../src/socket/ai-handlers/aiActionCandidateHandlers.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function buildMainPhaseState(playerId: string) {
  return {
    players: [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opp1', spectator: false, life: 40 },
      { id: 'opp2', name: 'Opp2', spectator: false, life: 35 },
      { id: 'opp3', name: 'Opp3', spectator: false, life: 40 },
    ],
    turnPlayer: playerId,
    activePlayer: playerId,
    priority: playerId,
    phase: 'main',
    step: 'precombat_main',
    turnNumber: 4,
    stack: [],
    life: { [playerId]: 40, opp1: 40, opp2: 35, opp3: 40 },
    manaPool: {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 3, colorless: 1 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      opp2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      opp3: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
    commanderDamage: {},
    battlefield: [
      {
        id: 'forest1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: { id: 'c_f1', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
      },
      {
        id: 'forest2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: { id: 'c_f2', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
      },
      {
        id: 'sol',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: { id: 'c_sol', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.', mana_cost: '{1}', cmc: 1 },
      },
      {
        id: 'opp_beast',
        controller: 'opp1',
        owner: 'opp1',
        tapped: false,
        summoningSickness: false,
        counters: {},
        effectivePower: 4,
        effectiveToughness: 4,
        card: {
          id: 'c_beast',
          name: 'Craw Wurm',
          type_line: 'Creature — Wurm',
          oracle_text: '',
          power: '4',
          toughness: '4',
        },
      },
    ],
    zones: {
      [playerId]: {
        hand: [
          {
            id: 'h_cult',
            name: 'Cultivate',
            type_line: 'Sorcery',
            oracle_text: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
            mana_cost: '{2}{G}',
            cmc: 3,
          },
        ],
        graveyard: [],
        exile: [],
        library: [
          { id: 'lib_a', name: 'Island', type_line: 'Basic Land — Island' },
          { id: 'lib_b', name: 'Swamp', type_line: 'Basic Land — Swamp' },
          { id: 'lib_c', name: 'Mountain', type_line: 'Basic Land — Mountain' },
        ],
      },
      opp1: {
        hand: [
          { id: 'o1h1', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', mana_cost: '{R}', cmc: 1 },
          { id: 'o1h2', name: 'Shock', type_line: 'Instant', oracle_text: 'Shock deals 2 damage to any target.', mana_cost: '{R}', cmc: 1 },
        ],
        graveyard: [],
        exile: [],
        library: [
          { id: 'o1l1', name: 'Mountain', type_line: 'Basic Land — Mountain' },
          { id: 'o1l2', name: 'Goblin Guide', type_line: 'Creature — Goblin Scout', power: '2', toughness: '2' },
        ],
      },
      opp2: {
        hand: [
          { id: 'o2h1', name: 'Counterspell', type_line: 'Instant', oracle_text: 'Counter target spell.', mana_cost: '{U}{U}', cmc: 2 },
        ],
        graveyard: [],
        exile: [],
        library: [{ id: 'o2l1', name: 'Island', type_line: 'Basic Land — Island' }],
      },
      opp3: {
        hand: [],
        graveyard: [],
        exile: [],
        library: [{ id: 'o3l1', name: 'Plains', type_line: 'Basic Land — Plains' }],
      },
    },
  };
}

function twinHiddenState(state: any, seat: string): any {
  const twin = deepClone(state);
  const zones = twin.zones;

  zones.opp1.hand = [
    { id: 'o1h1x', name: 'Lava Spike', type_line: 'Sorcery — Arcane', oracle_text: 'Lava Spike deals 3 damage to target player or planeswalker.', mana_cost: '{R}', cmc: 1 },
    { id: 'o1h2x', name: 'Burst Lightning', type_line: 'Instant', oracle_text: 'Kicker {4}. Burst Lightning deals 2 damage to any target. If this spell was kicked, it deals 4 damage instead.', mana_cost: '{R}', cmc: 1 },
  ];
  zones.opp1.library = [
    { id: 'o1l1x', name: 'Smoldering Crater', type_line: 'Land' },
    { id: 'o1l2x', name: 'Ball Lightning', type_line: 'Creature — Elemental', power: '6', toughness: '1' },
  ];
  zones.opp2.hand = [
    { id: 'o2h1x', name: 'Negate', type_line: 'Instant', oracle_text: 'Counter target noncreature spell.', mana_cost: '{1}{U}', cmc: 2 },
  ];
  zones.opp2.library = [{ id: 'o2l1x', name: 'Halimar Depths', type_line: 'Land' }];

  const lib = zones[seat].library;
  zones[seat].library = [lib[2], lib[0], lib[1]];
  return twin;
}

function summarizeCandidates(candidates: any[]) {
  return candidates.map((c) => ({
    kind: c.kind,
    priority: c.priority,
    name:
      c.kind === 'cast_spell'
        ? (c.spell?.castCard?.name || c.spell?.card?.name)
        : c.kind === 'cast_commander'
          ? c.commander?.card?.name
          : c.kind === 'activate_ability'
            ? c.ability?.action?.cardName
            : c.kind === 'play_land'
              ? c.land?.card?.name
              : undefined,
  }));
}

describe('AI observation leak (P0-2)', () => {
  const gameId = 'test_ai_observation_leak';
  const playerId = 'ai1';

  async function resetGame() {
    cleanupGameAI(gameId);
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame();
  });

  afterEach(async () => {
    await resetGame();
  });

  it('buildObservation is identical for a state and its hidden-zone twin', () => {
    const state = buildMainPhaseState(playerId);
    const twin = twinHiddenState(state, playerId);
    expect(buildObservation(state, playerId)).toEqual(buildObservation(twin, playerId));

    const obs = buildObservation(state, playerId);
    for (const opp of obs.opponents) {
      expect((opp as any).hand).toBeUndefined();
      expect((opp as any).library).toBeUndefined();
    }
  });

  it('enumerateAIActionCandidates ranks the same actions on the twin', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame failed');

    const baseState = buildMainPhaseState(playerId);
    Object.assign(game.state as any, baseState);
    registerAIPlayer(gameId, playerId as any);

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);

    const baseCandidates = summarizeCandidates(
      await enumerateAIActionCandidates(game, playerId as any, {
        mode: 'main',
        kinds: ['activate_ability', 'cast_commander', 'cast_spell'],
      }),
    );

    Object.assign(game.state as any, twinHiddenState(baseState, playerId));

    const twinCandidates = summarizeCandidates(
      await enumerateAIActionCandidates(game, playerId as any, {
        mode: 'main',
        kinds: ['activate_ability', 'cast_commander', 'cast_spell'],
      }),
    );

    randomSpy.mockRestore();
    expect(twinCandidates).toEqual(baseCandidates);
    expect(baseCandidates.length).toBeGreaterThan(0);
  });

  it('buildObservation is identical for declare-attackers and response twins', () => {
    const attackState = {
      ...buildMainPhaseState(playerId),
      phase: 'combat',
      step: 'declare_attackers',
      stack: [],
    };
    const attackTwin = twinHiddenState(attackState, playerId);
    expect(buildObservation(attackState, playerId)).toEqual(buildObservation(attackTwin, playerId));

    const responseState = {
      ...buildMainPhaseState(playerId),
      phase: 'main',
      step: 'precombat_main',
      priority: playerId,
      turnPlayer: 'opp1',
      activePlayer: 'opp1',
      stack: [
        {
          id: 'stk1',
          type: 'spell',
          controller: 'opp1',
          card: {
            id: 'bolt',
            name: 'Lightning Bolt',
            type_line: 'Instant',
            oracle_text: 'Lightning Bolt deals 3 damage to any target.',
            mana_cost: '{R}',
            cmc: 1,
          },
        },
      ],
    };
    const responseTwin = twinHiddenState(responseState, playerId);
    expect(buildObservation(responseState, playerId)).toEqual(buildObservation(responseTwin, playerId));
  });
});
