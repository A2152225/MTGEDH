import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerGameManagementHandlers } from '../src/socket/game-management.js';
import { games } from '../src/socket/socket.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      adapter: { rooms: new Map() },
      sockets: new Map(),
    },
  } as any;
}

function createMockSocket(data: any, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: 'sock_delete_1',
    data,
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
    broadcast: {
      emit: (event: string, payload: any) => emitted.push({ event, payload }),
    },
  } as any;
  return { socket, handlers };
}

describe('deleteGame authorization (integration)', () => {
  const gameId = 'test_delete_game_auth';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
  });

  it('blocks deleteGame when caller is not the creator (even if no players are connected)', async () => {
    const creator = 'p_creator';
    const attacker = 'p_attacker';

    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    // Ensure game exists in memory as well.
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: attacker, spectator: false }, emitted);

    const io = createMockIo(emitted);
    registerGameManagementHandlers(io as any, socket as any);

    await handlers['deleteGame']({ gameId, claimedPlayerId: attacker });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('DELETE_GAME_NOT_AUTHORIZED');

    const ack = emitted.find(e => e.event === 'gameDeletedAck');
    expect(ack).toBeUndefined();
  });

  it('does not throw when payload is missing (crash-safety)', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: 'p1', spectator: false }, emitted);

    const io = createMockIo(emitted);
    registerGameManagementHandlers(io as any, socket as any);

    expect(() => handlers['deleteGame'](undefined as any)).not.toThrow();
  });
});
