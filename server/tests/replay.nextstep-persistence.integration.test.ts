import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { PRIORITY_TIMEOUT_MS, games } from '../src/socket/socket.js';
import { broadcastGame, clearPriorityTimer, schedulePriorityTimeout } from '../src/socket/util.js';
import { createContext } from '../src/state/context.js';
import { passPriority } from '../src/state/modules/priority.js';
import { nextStep } from '../src/state/modules/turn.js';
import { viewFor } from '../src/state/modules/view.js';
import { createInitialGameState } from '../src/state/index.js';
import type { PlayerID } from '../../shared/src/index.js';

function createNoopIo() {
  const emit = vi.fn();
  return {
    emit,
    to: vi.fn(() => ({ emit })),
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

function createStepPersistenceHarness(
  gameId: string,
  overrides: Record<string, unknown> = {},
) {
  const ctx = createContext(gameId);
  Object.assign(ctx.state as any, {
    active: true,
    format: 'commander',
    phase: 'ending',
    step: 'END',
    turnDirection: 1,
    turnPlayer: 'p1',
    priority: 'p2',
    turnNumber: 1,
    turn: 1,
    players: [
      { id: 'p1', seat: 0, name: 'Player 1', spectator: false },
      { id: 'p2', seat: 1, name: 'Player 2', spectator: false },
    ],
    stack: [],
    battlefield: [],
    zones: {
      p1: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [] },
      p2: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [] },
    },
    manaPool: {
      p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
    priorityPassedBy: new Set(['p1']),
    ...overrides,
  });

  const game: any = {
    gameId,
    state: ctx.state,
    inactive: ctx.inactive,
    passesInRow: ctx.passesInRow,
    libraries: ctx.libraries,
    life: ctx.life,
    commandZone: ctx.commandZone,
    manaPool: ctx.manaPool,
    get seq() {
      return ctx.seq.value;
    },
    set seq(value: number) {
      ctx.seq.value = value;
    },
    bumpSeq: ctx.bumpSeq,
    participants: () => [],
    viewFor: (viewer?: PlayerID, spectator?: boolean) =>
      viewFor(ctx as any, (viewer ?? 'p1') as any, !!spectator),
    passPriority: (playerId: string, isAutoPass?: boolean) =>
      passPriority(ctx as any, playerId as any, isAutoPass),
    nextStep: () => nextStep(ctx as any),
  };

  return { ctx, game, io: createNoopIo() };
}

function toReplayEvents(gameId: string) {
  return getEvents(gameId).map((event: any) =>
    event?.payload && typeof event.payload === 'object'
      ? { type: event.type, ...(event.payload as Record<string, unknown>) }
      : { type: event.type },
  );
}

describe('replay nextStep persistence integration', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearPriorityTimer('replay_autopass_persists_nextstep');
    clearPriorityTimer('replay_cleanup_timeout_persists_nextstep');
    games.delete('replay_autopass_persists_nextstep');
    games.delete('replay_cleanup_timeout_persists_nextstep');
    vi.useRealTimers();
  });

  it('persists nextStep when broadcast auto-pass advances the step', () => {
    const gameId = 'replay_autopass_persists_nextstep';
    createGameIfNotExists(gameId, 'commander', 40);
    const { game, io } = createStepPersistenceHarness(gameId, {
      autoPassForTurn: { p2: true },
    });
    games.set(gameId, game);

    broadcastGame(io, game, gameId);

    const replayEvents = toReplayEvents(gameId);
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining(['passPriority', 'nextStep']),
    );
    expect((game.state as any).turnNumber).toBe(2);
    expect(String((game.state as any).step || '').toUpperCase()).toBe('UNTAP');

    const replayGame = createInitialGameState(`${gameId}_replay`);
    replayGame.applyEvent({ type: 'join', playerId: 'p1', name: 'Player 1' } as any);
    replayGame.applyEvent({ type: 'join', playerId: 'p2', name: 'Player 2' } as any);
    Object.assign(replayGame.state as any, {
      turnPlayer: 'p1',
      priority: 'p2',
      turnNumber: 1,
      turn: 1,
      phase: 'ending',
      step: 'END',
      stack: [],
      battlefield: [],
      priorityPassedBy: new Set(['p1']),
    });

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }
    replayGame.replay(replayEvents as any);

    expect((replayGame.state as any).turnNumber).toBe(2);
    expect(String((replayGame.state as any).step || '').toUpperCase()).toBe('UNTAP');
  });

  it('persists exactly one cleanup nextStep and restores the next turn on replay', async () => {
    const gameId = 'replay_cleanup_timeout_persists_nextstep';
    createGameIfNotExists(gameId, 'commander', 40);
    const { game, io } = createStepPersistenceHarness(gameId, {
      priority: null,
      phase: 'ending',
      step: 'CLEANUP',
      priorityPassedBy: new Set<string>(),
    });
    games.set(gameId, game);

    schedulePriorityTimeout(io, game, gameId);
    await vi.advanceTimersByTimeAsync(PRIORITY_TIMEOUT_MS);

    const replayEvents = toReplayEvents(gameId);
    const nextStepEvents = replayEvents.filter((event: any) => event.type === 'nextStep');
    expect(nextStepEvents).toHaveLength(1);
    expect((game.state as any).turnNumber).toBe(2);
    expect(String((game.state as any).step || '').toUpperCase()).toBe('UNTAP');

    const replayGame = createInitialGameState(`${gameId}_replay`);
    replayGame.applyEvent({ type: 'join', playerId: 'p1', name: 'Player 1' } as any);
    replayGame.applyEvent({ type: 'join', playerId: 'p2', name: 'Player 2' } as any);
    Object.assign(replayGame.state as any, {
      turnPlayer: 'p1',
      priority: null,
      turnNumber: 1,
      turn: 1,
      phase: 'ending',
      step: 'CLEANUP',
      stack: [],
      battlefield: [],
      priorityPassedBy: new Set<string>(),
    });

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }
    replayGame.replay(replayEvents as any);

    expect((replayGame.state as any).turnNumber).toBe(2);
    expect((replayGame.state as any).turn).toBe(2);
    expect(String((replayGame.state as any).step || '').toUpperCase()).toBe('UNTAP');
  });
});
