import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { games, priorityTimers } from '../src/socket/socket.js';
import { checkAndTriggerAutoPass, clearPriorityTimer } from '../src/socket/util.js';
import { registerDisconnectHandlers } from '../src/socket/disconnect.js';
import { refreshConnectedHumanClockOnReconnect } from '../src/socket/join-handlers/joinReconnectPlayer.js';
import {
  DISCONNECT_AUTOPASS_GRACE_MS,
  clearAllDisconnectAutoPassGraceForTests,
  clearDisconnectAutoPassGrace,
  hasDisconnectAutoPassGrace,
  isDisconnectAutoPassGraceBlocking,
  startDisconnectAutoPassGrace,
} from '../src/socket/disconnectAutoPassGrace.js';
import { pendingHumanAutoPassTimers } from '../src/socket/util-handlers/autoPassTimerState.js';
import { createContext } from '../src/state/context.js';
import { passPriority } from '../src/state/modules/priority.js';

const AUTO_PASS_DELAY_MS = 150;

function createIdleHarness(gameId: string) {
  const ctx = createContext(gameId);
  Object.assign(ctx.state as any, {
    active: true,
    phase: 'precombatMain',
    step: 'MAIN1',
    turnDirection: 1,
    turnPlayer: 'p_human',
    priority: 'p_human',
    players: [
      { id: 'p_human', seat: 1, name: 'Human', isAI: false },
      { id: 'p_opp', seat: 2, name: 'Opp', isAI: true },
    ],
    stack: [],
    zones: {
      p_human: { hand: [], graveyard: [], library: [] },
      p_opp: { hand: [], graveyard: [], library: [] },
    },
    battlefield: [],
    manaPool: {
      p_human: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      p_opp: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
    landsPlayedThisTurn: { p_human: 1, p_opp: 0 },
    priorityPassedBy: new Set<string>(),
    autoPassPlayers: new Set<string>(),
    priorityClaimed: new Set<string>(),
  });

  const participantsList: Array<{ socketId: string; playerId: string; spectator: boolean }> = [
    { socketId: 'sock_human', playerId: 'p_human', spectator: false },
  ];
  const joinedBySocket = new Map<string, { socketId: string; playerId: string; spectator: boolean }>([
    ['sock_human', { socketId: 'sock_human', playerId: 'p_human', spectator: false }],
  ]);

  const passPrioritySpy = vi.fn((playerId: string, isAutoPass?: boolean) =>
    passPriority(ctx, playerId as any, isAutoPass)
  );

  const game: any = {
    gameId,
    state: ctx.state,
    inactive: ctx.inactive,
    passesInRow: ctx.passesInRow,
    libraries: ctx.libraries,
    life: ctx.life,
    commandZone: ctx.commandZone,
    manaPool: ctx.manaPool,
    joinedBySocket,
    participantsList,
    get seq() {
      return ctx.seq.value;
    },
    set seq(value: number) {
      ctx.seq.value = value;
    },
    bumpSeq: ctx.bumpSeq,
    participants: () => participantsList.slice(),
    viewFor: () => ctx.state,
    passPriority: passPrioritySpy,
    disconnect: (socketId: string) => {
      joinedBySocket.delete(socketId);
      for (let i = participantsList.length - 1; i >= 0; i--) {
        if (participantsList[i].socketId === socketId) {
          participantsList.splice(i, 1);
        }
      }
    },
  };

  const emit = vi.fn();
  const io: any = {
    to: vi.fn(() => ({ emit })),
  };

  return { ctx, game, io, passPrioritySpy, participantsList, joinedBySocket };
}

function bindSeatedParticipant(game: any, socketId: string, playerId: string) {
  const participant = { socketId, playerId, spectator: false };
  for (const [existingSocketId, existing] of game.joinedBySocket as Map<string, any>) {
    if (existingSocketId === socketId || existing?.playerId === playerId) {
      game.joinedBySocket.delete(existingSocketId);
    }
  }
  game.joinedBySocket.set(socketId, participant);
  for (let i = game.participantsList.length - 1; i >= 0; i--) {
    const existing = game.participantsList[i];
    if (existing?.socketId === socketId || existing?.playerId === playerId) {
      game.participantsList.splice(i, 1);
    }
  }
  game.participantsList.push(participant);
}

describe('disconnect auto-pass reconnect grace', () => {
  const gameIds = [
    'grace_idle_would_pass',
    'grace_disconnect_holds',
    'grace_reconnect_within',
    'grace_expires_then_idle',
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    clearAllDisconnectAutoPassGraceForTests();
  });

  afterEach(() => {
    for (const id of gameIds) {
      clearPriorityTimer(id);
      clearDisconnectAutoPassGrace(id, 'p_human');
      pendingHumanAutoPassTimers.delete(id);
      games.delete(id);
    }
    clearAllDisconnectAutoPassGraceForTests();
    vi.useRealTimers();
  });

  it('auto-passes an idle connected human after the short delay (control)', async () => {
    const { ctx, game, io, passPrioritySpy } = createIdleHarness('grace_idle_would_pass');
    games.set(game.gameId, game);

    checkAndTriggerAutoPass(io, game, game.gameId);
    await vi.advanceTimersByTimeAsync(AUTO_PASS_DELAY_MS + 20);

    expect(passPrioritySpy).toHaveBeenCalledWith('p_human', true);
  });

  it('does not auto-pass for 20s after disconnect while idle/Smart-Pass would skip', async () => {
    const gameId = 'grace_disconnect_holds';
    const { ctx, game, io, passPrioritySpy } = createIdleHarness(gameId);
    games.set(game.gameId, game);

    const handlers: Record<string, Function> = {};
    const socket: any = {
      id: 'sock_human',
      data: { gameId, playerId: 'p_human', spectator: false },
      rooms: new Set([gameId]),
      on: (event: string, handler: Function) => {
        handlers[event] = handler;
      },
      emit: vi.fn(),
      leave: vi.fn(),
    };
    registerDisconnectHandlers(io, socket);

    checkAndTriggerAutoPass(io, game, gameId);
    expect(pendingHumanAutoPassTimers.has(gameId)).toBe(true);

    handlers['disconnect']();
    expect(pendingHumanAutoPassTimers.has(gameId)).toBe(false);
    expect(hasDisconnectAutoPassGrace(gameId, 'p_human')).toBe(true);
    expect(isDisconnectAutoPassGraceBlocking(gameId, 'p_human', game)).toBe(true);
    expect(game.participantsList).toHaveLength(0);

    checkAndTriggerAutoPass(io, game, gameId);
    await vi.advanceTimersByTimeAsync(AUTO_PASS_DELAY_MS + 50);
    expect(passPrioritySpy).not.toHaveBeenCalled();
    expect(ctx.state.priority).toBe('p_human');

    await vi.advanceTimersByTimeAsync(DISCONNECT_AUTOPASS_GRACE_MS - 400);
    expect(hasDisconnectAutoPassGrace(gameId, 'p_human')).toBe(true);
    checkAndTriggerAutoPass(io, game, gameId);
    await vi.advanceTimersByTimeAsync(AUTO_PASS_DELAY_MS);
    expect(passPrioritySpy).not.toHaveBeenCalled();
    expect(ctx.state.priority).toBe('p_human');
    expect(hasDisconnectAutoPassGrace(gameId, 'p_human')).toBe(true);
  });

  it('clears grace and stale idle timers on reconnect and restarts the 30s priority clock', async () => {
    const gameId = 'grace_reconnect_within';
    const { ctx, game, io, passPrioritySpy } = createIdleHarness(gameId);
    games.set(game.gameId, game);

    const handlers: Record<string, Function> = {};
    const socket: any = {
      id: 'sock_human',
      data: { gameId, playerId: 'p_human', spectator: false },
      rooms: new Set([gameId]),
      on: (event: string, handler: Function) => {
        handlers[event] = handler;
      },
      emit: vi.fn(),
      leave: vi.fn(),
    };
    registerDisconnectHandlers(io, socket);

    checkAndTriggerAutoPass(io, game, gameId);
    handlers['disconnect']();
    expect(isDisconnectAutoPassGraceBlocking(gameId, 'p_human', game)).toBe(true);

    bindSeatedParticipant(game, 'sock_human_rejoin', 'p_human');
    refreshConnectedHumanClockOnReconnect(io, game, gameId, 'p_human');

    expect(hasDisconnectAutoPassGrace(gameId, 'p_human')).toBe(false);
    expect(isDisconnectAutoPassGraceBlocking(gameId, 'p_human', game)).toBe(false);
    expect(pendingHumanAutoPassTimers.has(gameId)).toBe(false);
    expect(priorityTimers.has(gameId)).toBe(true);

    await vi.advanceTimersByTimeAsync(AUTO_PASS_DELAY_MS + 50);
    expect(passPrioritySpy).not.toHaveBeenCalled();
    expect(ctx.state.priority).toBe('p_human');

    await vi.advanceTimersByTimeAsync(DISCONNECT_AUTOPASS_GRACE_MS);
    expect(passPrioritySpy).not.toHaveBeenCalled();
    expect(ctx.state.priority).toBe('p_human');
    expect(hasDisconnectAutoPassGrace(gameId, 'p_human')).toBe(false);
  });

  it('allows idle auto-pass to run again after grace expires without reconnect', async () => {
    const gameId = 'grace_expires_then_idle';
    const { ctx, game, io, passPrioritySpy } = createIdleHarness(gameId);
    games.set(game.gameId, game);

    startDisconnectAutoPassGrace(gameId, 'p_human');
    game.disconnect('sock_human');
    expect(isDisconnectAutoPassGraceBlocking(gameId, 'p_human', game)).toBe(true);

    checkAndTriggerAutoPass(io, game, gameId);
    await vi.advanceTimersByTimeAsync(AUTO_PASS_DELAY_MS + 20);
    expect(passPrioritySpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DISCONNECT_AUTOPASS_GRACE_MS);
    expect(hasDisconnectAutoPassGrace(gameId, 'p_human')).toBe(false);
    expect(isDisconnectAutoPassGraceBlocking(gameId, 'p_human', game)).toBe(false);
    expect(passPrioritySpy).not.toHaveBeenCalled();
    expect(ctx.state.priority).toBe('p_human');

    checkAndTriggerAutoPass(io, game, gameId);
    await vi.advanceTimersByTimeAsync(AUTO_PASS_DELAY_MS + 20);
    expect(passPrioritySpy).toHaveBeenCalledWith('p_human', true);
  });
});
