import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { registerJoinHandlers } from '../src/socket/join.js';
import { games } from '../src/socket/socket.js';
import { ensureGame, broadcastGame } from '../src/socket/util.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(socketId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: socketId,
    data: { spectator: false },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
    join: (room: string) => {
      socket.rooms.add(room);
    },
    to: (_room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ event, payload }),
    }),
  } as any;

  return { socket, handlers };
}

describe('joinGame reconnect broadcast delivery (integration)', () => {
  const gameId = 'test_join_reconnect_broadcast_delivery';
  const playerId = 'p_reconnect';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
  });

  it('rebinds the participant socket id so later broadcasts reach the refreshed client', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      {
        id: playerId,
        name: 'Reconnect Tester',
        spectator: false,
        life: 40,
        seatToken: 'seat_reconnect',
      },
    ];
    (game as any).participantsList.length = 0;
    (game as any).participantsList.push({
      socketId: 'stale_socket',
      playerId,
      spectator: false,
    });
    (game as any).joinedBySocket.clear();
    (game as any).joinedBySocket.set('stale_socket', {
      socketId: 'stale_socket',
      playerId,
      spectator: false,
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket('fresh_socket', emitted);

    registerJoinHandlers(io as any, socket as any);

    await handlers['joinGame']({ gameId, fixedPlayerId: playerId });

    emitted.length = 0;
    broadcastGame(io as any, game as any, gameId);

    const stateToFreshSocket = emitted.find(
      (entry) => entry.room === 'fresh_socket' && entry.event === 'state'
    );
    const stateToStaleSocket = emitted.find(
      (entry) => entry.room === 'stale_socket' && entry.event === 'state'
    );

    expect(stateToFreshSocket).toBeDefined();
    expect(stateToFreshSocket?.payload?.gameId).toBe(gameId);
    expect(stateToStaleSocket).toBeUndefined();
    expect((game as any).participantsList).toEqual([
      {
        socketId: 'fresh_socket',
        playerId,
        spectator: false,
      },
    ]);
  });
});