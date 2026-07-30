import { describe, expect, it } from 'vitest';

import { passPriority } from '../src/state/modules/priority.js';
import type { GameContext } from '../src/state/context.js';

function buildCtx(state: any, gameId = 'main_phase_auto_advance'): GameContext {
  return {
    gameId,
    state,
    libraries: new Map([
      ['p_ap', [{ id: 'lib1', name: 'Island', type_line: 'Basic Land — Island' }]],
      ['p_ai', []],
      ['p_other', []],
    ]),
    life: { p_ap: 40, p_ai: 40, p_other: 40 },
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
    landsPlayedThisTurn: { p_ap: 1 },
    maxLandsPerTurn: {},
    additionalDrawsPerTurn: {},
    manaPool: state.manaPool || {},
  } as GameContext;
}

describe('main-phase auto step-advance guard', () => {
  it('does not advance MAIN1 when an auto-pass chain marks the active player passed while they still have actions', () => {
    const state: any = {
      players: [
        { id: 'p_ai', name: 'AI', seat: 0, isAI: true },
        { id: 'p_other', name: 'Other', seat: 1 },
        { id: 'p_ap', name: 'Active', seat: 2 },
      ],
      battlefield: [
        {
          id: 'sol_1',
          controller: 'p_ap',
          tapped: false,
          card: {
            id: 'sol_card',
            name: 'Sol Ring',
            type_line: 'Artifact',
            oracle_text: '{T}: Add {C}{C}.',
            mana_cost: '{1}',
          },
        },
      ],
      stack: [],
      zones: {
        p_ap: {
          hand: [
            {
              id: 'counter_1',
              name: 'Counterspell',
              type_line: 'Instant',
              oracle_text: 'Counter target spell.',
              mana_cost: '{U}{U}',
            },
            {
              id: 'creature_1',
              name: 'Kopala, Warden of Waves',
              type_line: 'Legendary Creature — Merfolk Wizard',
              oracle_text: 'Spells your opponents cast that target a Merfolk you control cost {2} more to cast.',
              mana_cost: '{1}{U}{U}',
            },
          ],
          handCount: 2,
          library: [],
          libraryCount: 0,
          graveyard: [],
        },
        p_ai: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [] },
        p_other: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [] },
      },
      priority: 'p_ai',
      turnPlayer: 'p_ap',
      phase: 'precombatMain',
      step: 'MAIN1',
      // Stale membership: active player never took an empty-stack priority round.
      priorityPassedBy: new Set<string>(['p_ap', 'p_other']),
      autoPassPlayers: new Set(['p_ap', 'p_ai', 'p_other']),
      landsPlayedThisTurn: { p_ap: 1 },
      manaPool: {
        p_ap: { white: 0, blue: 5, black: 0, red: 0, green: 0, colorless: 0 },
        p_ai: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        p_other: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      turnDirection: 1,
    };

    const ctx = buildCtx(state);
    const result = passPriority(ctx, 'p_ai', true);

    expect(result.changed).toBe(true);
    expect(result.advanceStep).toBe(false);
    expect(state.priority).toBe('p_ap');
    expect(state.step).toBe('MAIN1');
    expect(state.priorityPassedBy.size).toBe(0);
  });

  it('advances after the active AI explicitly exhausts its supported main-phase actions', () => {
    const state: any = {
      players: [
        { id: 'p_ai', name: 'AI', seat: 0, isAI: true },
        { id: 'p_other', name: 'Other', seat: 1 },
      ],
      battlefield: [],
      stack: [],
      zones: {
        p_ai: {
          hand: [{
            id: 'spell_1',
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            oracle_text: '',
            mana_cost: '{1}{G}',
          }],
          handCount: 1,
          library: [],
          libraryCount: 0,
          graveyard: [],
        },
        p_other: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [] },
      },
      priority: 'p_ai',
      turnPlayer: 'p_ai',
      phase: 'precombatMain',
      step: 'MAIN1',
      priorityPassedBy: new Set<string>(),
      autoPassPlayers: new Set(['p_ai', 'p_other']),
      landsPlayedThisTurn: { p_ai: 1 },
      manaPool: {
        p_ai: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
        p_other: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      turnDirection: 1,
    };

    const ctx = buildCtx(state, 'ai_exhausted_main_phase_actions');
    const result = passPriority(ctx, 'p_ai', true, {
      allowActiveMainPhaseAutoAdvance: true,
    });

    expect(result.changed).toBe(true);
    expect(result.advanceStep).toBe(true);
    expect(state.priority).toBe('p_ai');
    expect(state.priorityPassedBy.size).toBe(0);
  });

  it('still advances MAIN1 when the active player manually passes with others already passed', () => {
    const state: any = {
      players: [
        { id: 'p_ap', name: 'Active', seat: 0 },
        { id: 'p_ai', name: 'AI', seat: 1, isAI: true },
      ],
      battlefield: [],
      stack: [],
      zones: {
        p_ap: {
          hand: [
            {
              id: 'bolt_1',
              name: 'Lightning Bolt',
              type_line: 'Instant',
              oracle_text: 'Lightning Bolt deals 3 damage to any target.',
              mana_cost: '{R}',
            },
          ],
          handCount: 1,
          library: [],
          libraryCount: 0,
          graveyard: [],
        },
        p_ai: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [] },
      },
      priority: 'p_ap',
      turnPlayer: 'p_ap',
      phase: 'precombatMain',
      step: 'MAIN1',
      priorityPassedBy: new Set<string>(['p_ai']),
      autoPassPlayers: new Set(['p_ai']),
      landsPlayedThisTurn: { p_ap: 1 },
      manaPool: {
        p_ap: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
        p_ai: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      turnDirection: 1,
    };

    const ctx = buildCtx(state);
    const result = passPriority(ctx, 'p_ap', false);

    expect(result.changed).toBe(true);
    expect(result.advanceStep).toBe(true);
    expect(state.priority).toBe('p_ap');
  });

  it('preserves a manual phase pass while opponents subsequently auto-pass', () => {
    const state: any = {
      players: [
        { id: 'p_ap', name: 'Active', seat: 0 },
        { id: 'p_ai', name: 'AI', seat: 1, isAI: true },
      ],
      battlefield: [],
      stack: [],
      zones: {
        p_ap: {
          hand: [{
            id: 'mox_diamond',
            name: 'Mox Diamond',
            type_line: 'Artifact',
            mana_cost: '{0}',
            oracle_text: 'If Mox Diamond would enter the battlefield, you may discard a land card instead.',
          }],
          handCount: 1,
          library: [],
          libraryCount: 0,
          graveyard: [],
        },
        p_ai: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [] },
      },
      priority: 'p_ap',
      turnPlayer: 'p_ap',
      phase: 'precombatMain',
      step: 'MAIN1',
      priorityPassedBy: new Set<string>(),
      autoPassPlayers: new Set(['p_ai']),
      landsPlayedThisTurn: { p_ap: 1 },
      manaPool: {
        p_ap: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        p_ai: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      turnDirection: 1,
    };

    const ctx = buildCtx(state);
    const manualPass = passPriority(ctx, 'p_ap', false);
    expect(manualPass.advanceStep).toBe(false);
    expect(state.priority).toBe('p_ai');

    const opponentAutoPass = passPriority(ctx, 'p_ai', true);
    expect(opponentAutoPass.advanceStep).toBe(true);
    expect(state.priority).toBe('p_ap');
  });
});
