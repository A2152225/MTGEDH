import { describe, expect, it } from 'vitest';

import { games } from '../src/socket/socket.js';
import { registerPriorityHandlers } from '../src/socket/priority.js';
import { tryAutoPass } from '../src/state/modules/priority.js';
import { isPlayerIdleForAutoPass } from '../src/state/modules/can-respond.js';
import type { GameContext } from '../src/state/context.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
  } as any;
}

function createMockSocket(
  playerId: string,
  gameId: string,
  emitted: Array<{ room?: string; event: string; payload: any }>,
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  return { socket, handlers };
}

function buildCtx(state: any, gameId: string): GameContext {
  return {
    gameId,
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

describe('human auto-pass registration', () => {
  const gameId = 'autopass_human_sync';

  it('registers auto-pass via syncOnly and evaluates when that player has priority', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    const io = createMockIo(emitted);

    games.set(gameId as any, {
      state: {
        players: [
          { id: 'p1', name: 'Human', seat: 0 },
          { id: 'p2', name: 'Other', seat: 1, isAI: true },
        ],
        battlefield: [],
        stack: [],
        priority: 'p1',
        turnPlayer: 'p2',
        phase: 'combat',
        step: 'DAMAGE',
        priorityPassedBy: new Set<string>(),
        autoPassPlayers: new Set(['p2']),
        landsPlayedThisTurn: {},
        manaPool: {},
      },
      bumpSeq: () => {},
      participants: () => [],
    } as any);

    registerPriorityHandlers(io as any, socket as any);

    handlers['setAutoPass']({ gameId, enabled: true, syncOnly: true });
    await Promise.resolve();

    const game = games.get(gameId as any) as any;
    expect((game.state as any).autoPassPlayers?.has('p1')).toBe(true);
    expect(emitted.some((entry) => entry.event === 'autoPassToggled' && entry.payload?.enabled === true)).toBe(true);
  });

  it('syncs the empty-stack opponent-turn preference', () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    const io = createMockIo(emitted);

    games.set(gameId as any, {
      state: {
        players: [
          { id: 'p1', name: 'Human', seat: 0 },
          { id: 'p2', name: 'Other', seat: 1 },
        ],
        battlefield: [],
        stack: [],
        priority: 'p2',
        turnPlayer: 'p2',
      },
      bumpSeq: () => {},
      participants: () => [],
    } as any);

    registerPriorityHandlers(io as any, socket as any);
    handlers['setAutoPassEmptyStackOnOpponentsTurn']({
      gameId,
      enabled: true,
      syncOnly: true,
    });

    const game = games.get(gameId as any) as any;
    expect(game.state.autoPassEmptyStackOnOpponentsTurn).toEqual({ p1: true });
  });

  it('enables the one-turn empty-stack pass option', () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    const io = createMockIo(emitted);

    games.set(gameId as any, {
      state: {
        players: [
          { id: 'p1', name: 'Human', seat: 0 },
          { id: 'p2', name: 'Other', seat: 1 },
        ],
        battlefield: [],
        stack: [],
        priority: 'p2',
        turnPlayer: 'p2',
      },
      bumpSeq: () => {},
      participants: () => [],
    } as any);

    registerPriorityHandlers(io as any, socket as any);
    handlers['setAutoPassEmptyStackForTurn']({ gameId, enabled: true });

    const game = games.get(gameId as any) as any;
    expect(game.state.autoPassEmptyStackForTurn).toEqual({ p1: true });
  });

  it('auto-passes for autoPassForTurn even when autoPassPlayers is empty', () => {
    const state: any = {
      players: [
        { id: 'p1', name: 'Human', seat: 0 },
        { id: 'p2', name: 'Other', seat: 1 },
      ],
      battlefield: [],
      stack: [
        {
          id: 'bolt_on_stack',
          controller: 'p1',
          card: {
            id: 'bolt_card',
            name: 'Lightning Bolt',
            type_line: 'Instant',
            oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          },
        },
      ],
      priority: 'p1',
      turnPlayer: 'p2',
      phase: 'combat',
      step: 'DAMAGE',
      priorityPassedBy: new Set<string>(),
      autoPassPlayers: new Set<string>(),
      autoPassForTurn: { p1: true },
      landsPlayedThisTurn: {},
      manaPool: {
        p2: { white: 0, blue: 2, black: 0, red: 0, green: 0, colorless: 0 },
      },
      zones: {
        p1: { hand: [], graveyard: [], exile: [] },
        p2: {
          hand: [
            {
              id: 'counterspell',
              name: 'Counterspell',
              type_line: 'Instant',
              oracle_text: 'Counter target spell.',
              mana_cost: '{U}{U}',
            },
          ],
          graveyard: [],
          exile: [],
        },
      },
    };

    const ctx = buildCtx(state, gameId);
    expect(isPlayerIdleForAutoPass(ctx, 'p2')).toBe(false);

    const result = tryAutoPass(ctx);

    expect(result.allPassed).toBe(false);
    expect(state.priorityPassedBy.has('p1')).toBe(true);
    expect(state.priority).toBe('p2');
  });

  it('auto-passes idle humans even when autoPassPlayers is empty', () => {
    const idleGameId = 'autopass_idle_no_pref';
    const state: any = {
      players: [
        { id: 'p1', name: 'Human', seat: 0 },
        { id: 'p2', name: 'Other', seat: 1 },
      ],
      battlefield: [
        {
          id: 'tapped_creature',
          controller: 'p1',
          tapped: true,
          card: {
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            oracle_text: '',
          },
        },
      ],
      stack: [],
      priority: 'p1',
      turnPlayer: 'p1',
      phase: 'precombatMain',
      step: 'MAIN1',
      priorityPassedBy: new Set<string>(),
      autoPassPlayers: new Set<string>(),
      landsPlayedThisTurn: { p1: 1 },
      zones: {
        p1: { hand: [], graveyard: [], exile: [] },
        p2: { hand: [], graveyard: [], exile: [] },
      },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 0 },
      },
    };

    const ctx = buildCtx(state, idleGameId);
    expect(isPlayerIdleForAutoPass(ctx, 'p1')).toBe(true);

    const result = tryAutoPass(ctx);
    expect(result.allPassed).toBe(true);
    expect(result.advanceStep).toBe(true);
  });
});
