import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists, appendEvent, truncateEventsForUndo } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerReplayHandlers } from '../src/socket/replay.js';
import { games } from '../src/socket/socket.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])),
    },
  } as any;
}

function createMockSocket(
  playerId: string,
  emitted: Array<{ room?: string; event: string; payload: any }>,
  spectator = false,
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: `sock_${playerId}`,
    data: { playerId, spectator },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('replay authorization (integration)', () => {
  const gameId = 'test_replay_authorization';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
    try {
      truncateEventsForUndo(gameId, 0);
    } catch {
      // ignore
    }
  });

  it('does not allow startReplay when not in the game room', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).gameOver = true;

    appendEvent(gameId, 0, 'drawCards', { playerId: p1, n: 1 });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    // Note: socket not joined to gameId room.

    const io = createMockIo(emitted, [socket]);
    registerReplayHandlers(io as any, socket as any);

    await handlers['startReplay']({ gameId });

    const err = emitted.find(e => e.event === 'error' && e.payload?.code === 'NOT_IN_GAME');
    expect(err).toBeTruthy();

    const started = emitted.find(e => e.event === 'replayStarted');
    expect(started).toBeUndefined();
  });

  it('does not allow startReplay when socket.data.gameId mismatches (even if in room)', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).gameOver = true;

    appendEvent(gameId, 0, 'drawCards', { playerId: p1, n: 1 });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    (socket.data as any).gameId = 'other_game';
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerReplayHandlers(io as any, socket as any);

    await handlers['startReplay']({ gameId });

    const err = emitted.find(e => e.event === 'error' && e.payload?.code === 'NOT_IN_GAME');
    expect(err).toBeTruthy();

    const started = emitted.find(e => e.event === 'replayStarted');
    expect(started).toBeUndefined();
  });

  it('does not allow startReplay before gameOver', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).gameOver = false;

    appendEvent(gameId, 0, 'drawCards', { playerId: p1, n: 1 });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerReplayHandlers(io as any, socket as any);

    await handlers['startReplay']({ gameId });

    const err = emitted.find(e => e.event === 'error' && e.payload?.code === 'REPLAY_NOT_AVAILABLE');
    expect(err).toBeTruthy();

    const started = emitted.find(e => e.event === 'replayStarted');
    expect(started).toBeUndefined();
  });

  it('allows startReplay after gameOver for in-room participant', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).gameOver = true;

    appendEvent(gameId, 0, 'drawCards', { playerId: p1, n: 1 });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerReplayHandlers(io as any, socket as any);

    await handlers['startReplay']({ gameId });

    const err = emitted.find(e => e.event === 'error');
    expect(err).toBeUndefined();

    const started = emitted.find(e => e.event === 'replayStarted');
    expect(started).toBeTruthy();
    expect(started!.payload?.gameId).toBe(gameId);
    expect(typeof started!.payload?.totalEvents).toBe('number');
  });
});
