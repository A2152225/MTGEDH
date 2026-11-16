import { describe, expect, it } from 'vitest';

import { canAct, canPlayLand, isPlayerIdleForAutoPass } from '../src/state/modules/can-respond.js';
import { calculateMaxLandsPerTurn } from '../src/state/modules/game-state-effects.js';
import type { GameContext } from '../src/state/context.js';

function buildCtx(state: any): GameContext {
  return {
    gameId: 'summer-bloom-autopass',
    state,
    libraries: new Map(),
    life: {},
    poison: {},
    experience: {},
    commandZone: {},
    joinedBySocket: new Map(),
    participantsList: [],
    tokenToPlayer: new Map(),
    playerToToken: new Map(),
    grants: new Map(),
    inactive: new Set(),
    spectatorNames: new Map(),
    pendingInitialDraw: new Set(),
    handVisibilityGrants: new Map(),
    rngSeed: null,
    rng: () => 0,
    seq: { value: 0 },
    bumpSeq: () => {},
    passesInRow: { value: 0 },
    landsPlayedThisTurn: state.landsPlayedThisTurn || {},
    maxLandsPerTurn: {},
    additionalDrawsPerTurn: {},
    manaPool: state.manaPool || {},
  } as GameContext;
}

describe('Summer Bloom land drops block auto-pass when tapped out', () => {
  it('keeps canAct / canPlayLand true after the normal land drop when additionalLandsThisTurn remains', () => {
    const forest = {
      id: 'forest_hand',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.',
    };
    const state = {
      players: [
        { id: 'p1', name: 'Human', seat: 0 },
        { id: 'p2', name: 'Opp', seat: 1 },
      ],
      zones: {
        p1: {
          hand: [forest, { id: 'other', name: 'Sol Ring', type_line: 'Artifact', mana_cost: '{1}' }],
          library: [],
          graveyard: [],
          exile: [],
        },
        p2: { hand: [], library: [], graveyard: [], exile: [] },
      },
      battlefield: [
        {
          id: 'forest_bf',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          card: { id: 'forest_bf_card', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
        },
      ],
      stack: [],
      phase: 'main',
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      turnNumber: 3,
      landsPlayedThisTurn: { p1: 1 },
      // What Summer Bloom IR must stamp so calculateMaxLandsPerTurn sees +3.
      additionalLandsThisTurn: { p1: 3 },
      manaPool: { p1: {} },
    };

    const ctx = buildCtx(state);

    expect(calculateMaxLandsPerTurn(ctx, 'p1')).toBe(4);
    expect(canPlayLand(ctx, 'p1')).toBe(true);
    expect(canAct(ctx, 'p1')).toBe(true);
    expect(isPlayerIdleForAutoPass(ctx, 'p1')).toBe(false);
  });

  it('still auto-pass idle when land drops are exhausted even with lands in hand', () => {
    const state = {
      players: [
        { id: 'p1', name: 'Human', seat: 0 },
        { id: 'p2', name: 'Opp', seat: 1 },
      ],
      zones: {
        p1: {
          hand: [{ id: 'forest_hand', name: 'Forest', type_line: 'Basic Land — Forest' }],
          library: [],
          graveyard: [],
          exile: [],
        },
        p2: { hand: [], library: [], graveyard: [], exile: [] },
      },
      battlefield: [
        {
          id: 'forest_bf',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          card: { id: 'forest_bf_card', name: 'Forest', type_line: 'Basic Land — Forest' },
        },
      ],
      stack: [],
      phase: 'main',
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      turnNumber: 3,
      landsPlayedThisTurn: { p1: 1 },
      additionalLandsThisTurn: {},
      manaPool: { p1: {} },
    };

    const ctx = buildCtx(state);
    expect(calculateMaxLandsPerTurn(ctx, 'p1')).toBe(1);
    expect(canPlayLand(ctx, 'p1')).toBe(false);
  });
});
