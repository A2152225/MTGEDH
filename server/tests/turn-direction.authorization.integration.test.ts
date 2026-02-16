import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { games } from '../src/socket/socket.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(data: any, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { spectator: false, ...data },
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

describe('setTurnDirection authorization (integration)', () => {
  const gameId = 'test_turn_direction_authorization';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
    try {
      deleteGame(gameId);
    } catch {
      // ignore
    }
  });

  it('does not allow non-creator to set turn direction', async () => {
    const creator = 'creator';
    const attacker = 'attacker';

    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: creator, name: 'Creator', spectator: false, life: 40 },
      { id: attacker, name: 'Attacker', spectator: false, life: 40 },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: attacker, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);

    const before = (game.state as any).turnDirection;

    await handlers['setTurnDirection']({ gameId, direction: -1 });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_AUTHORIZED');
    expect((game.state as any).turnDirection).toBe(before);
  });

  it('allows creator to set turn direction', async () => {
    const creator = 'creator';

    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: creator, name: 'Creator', spectator: false, life: 40 }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: creator, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);

    const before = (game.state as any).turnDirection;
    await handlers['setTurnDirection']({ gameId, direction: -1 });

    const err = emitted.find(e => e.event === 'error');
    expect(err).toBeUndefined();
    expect((game.state as any).turnDirection).not.toBe(before);
    expect((game.state as any).turnDirection).toBe(-1);
  });

  it('does not allow setting turn direction when socket.data.gameId mismatches (even if in room)', async () => {
    const creator = 'creator';

    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: creator, name: 'Creator', spectator: false, life: 40 }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: creator, gameId: 'other_game' }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);

    const before = (game.state as any).turnDirection;
    await handlers['setTurnDirection']({ gameId, direction: -1 });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');
    expect((game.state as any).turnDirection).toBe(before);
  });

  it('does not throw when payload is missing (crash-safety)', async () => {
    const creator = 'creator';

    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: creator, name: 'Creator', spectator: false, life: 40 }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: creator, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);

    expect(() => handlers['setTurnDirection'](undefined as any)).not.toThrow();
  });
});
