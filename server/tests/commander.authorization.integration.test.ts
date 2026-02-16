import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerCommanderHandlers } from '../src/socket/commander.js';
import { games } from '../src/socket/socket.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

function createMockSocket(
  data: any,
  emitted: Array<{ room?: string; event: string; payload: any }>
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: 'sock_1',
    data,
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

describe('commander authorization (integration)', () => {
  const gameId = 'test_commander_auth';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
  });

  it('blocks setCommander when socket is not in the game room', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    // Intentionally do NOT join the room.

    const io = createMockIo(emitted);
    registerCommanderHandlers(io as any, socket as any);

    await handlers['setCommander']({ gameId, commanderNames: ['Atraxa, Praetors\' Voice'] });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');

    expect((game.state as any).commandZone?.[p1]).toBeUndefined();
  });

  it('blocks setCommander when socket.data.gameId mismatches (even if in room)', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId: 'other_game' }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerCommanderHandlers(io as any, socket as any);

    await handlers['setCommander']({ gameId, commanderNames: ['Atraxa, Praetors\' Voice'] });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');
    expect((game.state as any).commandZone?.[p1]).toBeUndefined();
  });

  it('allows in-room castCommander when socket.data.gameId is unset (fails later, but not NOT_IN_GAME)', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    // Note: castCommander has its own phase gating, but we don't rely on it here.
    // We just want to prove the in-room guard allows sockets with unset socket.data.gameId.
    delete (game.state as any).phase;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerCommanderHandlers(io as any, socket as any);

    await handlers['castCommander']({ gameId, commanderId: 'dummy_commander_id' });

    const notInGame = emitted.find(e => e.event === 'error' && e.payload?.code === 'NOT_IN_GAME');
    expect(notInGame).toBeUndefined();

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('PREGAME_NO_CAST');
  });

  it('blocks dumpLibrary unless caller is judge in-room', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId, role: undefined }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerCommanderHandlers(io as any, socket as any);

    await handlers['dumpLibrary']({ gameId });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_AUTHORIZED');

    const debugDump = emitted.find(e => e.event === 'debugLibraryDump');
    expect(debugDump).toBeUndefined();
  });

  it('does not throw when debug dump payload is missing (crash-safety)', async () => {
    const p1 = 'p1';
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    const io = createMockIo(emitted);
    registerCommanderHandlers(io as any, socket as any);

    expect(() => handlers['dumpLibrary'](undefined as any)).not.toThrow();
    expect(() => handlers['dumpImportedDeckBuffer'](undefined as any)).not.toThrow();
    expect(() => handlers['dumpCommanderState'](undefined as any)).not.toThrow();
  });

  it('does not throw when commander action payload is missing (crash-safety)', async () => {
    const p1 = 'p1';
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    const io = createMockIo(emitted);
    registerCommanderHandlers(io as any, socket as any);

    expect(() => handlers['castCommander'](undefined as any)).not.toThrow();
    expect(() => handlers['moveCommanderToCommandZone'](undefined as any)).not.toThrow();

    const castErr = emitted.find(e => e.event === 'error' && e.payload?.code === 'CAST_COMMANDER_INVALID');
    expect(castErr).toBeDefined();

    const moveErr = emitted.find(e => e.event === 'error' && e.payload?.code === 'MOVE_COMMANDER_INVALID');
    expect(moveErr).toBeDefined();
  });
});
