import { describe, expect, it } from 'vitest';

import { games } from '../src/socket/socket.js';
import { registerPriorityHandlers } from '../src/socket/priority.js';
import { tryAutoPass } from '../src/state/modules/priority.js';
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

  it('auto-passes for autoPassForTurn even when autoPassPlayers is empty', () => {
    const state: any = {
      players: [
        { id: 'p1', name: 'Human', seat: 0 },
        { id: 'p2', name: 'Other', seat: 1 },
      ],
      battlefield: [],
      stack: [],
      priority: 'p1',
      turnPlayer: 'p2',
      phase: 'combat',
      step: 'DAMAGE',
      priorityPassedBy: new Set<string>(),
      autoPassPlayers: new Set<string>(),
      autoPassForTurn: { p1: true },
      landsPlayedThisTurn: {},
      manaPool: {},
    };

    const ctx = buildCtx(state, gameId);
    const result = tryAutoPass(ctx);

    expect(result.allPassed).toBe(false);
    expect(state.priorityPassedBy.has('p1')).toBe(true);
    expect(state.priority).toBe('p2');
  });
});
