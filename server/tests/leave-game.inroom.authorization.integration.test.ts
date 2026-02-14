import { describe, it, expect, beforeEach } from 'vitest';
import { registerDisconnectHandlers } from '../src/socket/disconnect.js';
import { games } from '../src/socket/socket.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
  } as any;
}

function createMockSocket(
  opts: {
    playerId?: string;
    gameId?: string | null;
  },
  emitted: Array<{ room?: string; event: string; payload: any }>
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: `sock_${opts.playerId || 'anon'}`,
    data: { playerId: opts.playerId, gameId: opts.gameId },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
    leave: (room: string) => {
      (socket as any).rooms.delete(room);
    },
  } as any;

  return { socket, handlers };
}

describe('leaveGame in-room scoping (integration)', () => {
  const gameId = 'test_leave_game_inroom';

  beforeEach(() => {
    games.delete(gameId as any);
  });

  it('rejects leaveGame when socket is not in the game room', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: 'p1', gameId }, emitted);

    const leaveCalls: string[] = [];
    games.set(gameId as any, {
      seq: 0,
      state: { players: [{ id: 'p1' }] },
      leave: (pid: string) => {
        leaveCalls.push(pid);
        return false;
      },
    } as any);

    const io = createMockIo(emitted);
    registerDisconnectHandlers(io as any, socket as any);

    await handlers['leaveGame']({ gameId });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');
    expect(leaveCalls.length).toBe(0);
  });

  it('rejects leaveGame when socket.data.gameId mismatches payload gameId', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: 'p1', gameId: 'other_game' }, emitted);
    socket.rooms.add(gameId);

    const leaveCalls: string[] = [];
    games.set(gameId as any, {
      seq: 0,
      state: { players: [{ id: 'p1' }] },
      leave: (pid: string) => {
        leaveCalls.push(pid);
        return false;
      },
    } as any);

    const io = createMockIo(emitted);
    registerDisconnectHandlers(io as any, socket as any);

    await handlers['leaveGame']({ gameId });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');
    expect(leaveCalls.length).toBe(0);
  });

  it('allows leaveGame when socket is in room and gameId matches', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: 'p1', gameId }, emitted);
    socket.rooms.add(gameId);

    games.set(gameId as any, {
      seq: 0,
      state: { players: [{ id: 'p1' }] },
      leave: () => false,
    } as any);

    const io = createMockIo(emitted);
    registerDisconnectHandlers(io as any, socket as any);

    await handlers['leaveGame']({ gameId });

    const err = emitted.find(e => e.event === 'error');
    expect(err).toBeUndefined();
    expect(socket.rooms.has(gameId)).toBe(false);
    expect(socket.data.gameId).toBe(null);
  });
});
