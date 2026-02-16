import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import registerSundialHandlers from '../src/socket/sundial.js';
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

describe('sundialActivate in-room authorization (integration)', () => {
  const gameId = 'test_sundial_inroom';

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

  it('rejects sundialActivate when socket is not in the game room', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    let nextTurnCalled = false;
    (game as any).nextTurn = () => {
      nextTurnCalled = true;
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, gameId }, emitted);

    const io = createMockIo(emitted);
    registerSundialHandlers(io as any, socket as any);

    await handlers['sundialActivate']({ gameId, action: 'endTurn' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');
    expect(nextTurnCalled).toBe(false);
  });

  it('rejects sundialActivate when socket.data.gameId mismatches (even if in room)', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    let nextTurnCalled = false;
    (game as any).nextTurn = () => {
      nextTurnCalled = true;
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, gameId: 'other_game' }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerSundialHandlers(io as any, socket as any);

    await handlers['sundialActivate']({ gameId, action: 'endTurn' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');
    expect(nextTurnCalled).toBe(false);
  });

  it('rejects sundialActivate when player does not control a battlefield Sundial (even if they have one in hand)', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).priority = p1;
    (game.state as any).manaPool = { [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 } };
    (game.state as any).battlefield = [];
    (game.state as any).zones = {
      [p1]: {
        hand: [{ id: 'c1', name: 'Sundial of the Infinite' }],
      },
    };

    let nextTurnCalled = false;
    (game as any).nextTurn = () => {
      nextTurnCalled = true;
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerSundialHandlers(io as any, socket as any);

    await handlers['sundialActivate']({ gameId, action: 'endTurn' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_AUTHORIZED');
    expect(nextTurnCalled).toBe(false);
  });

  it("rejects sundialActivate when player doesn't have priority", async () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).priority = p2;
    (game.state as any).manaPool = { [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 } };
    (game.state as any).battlefield = [
      { id: 'perm1', controller: p1, tapped: false, card: { name: 'Sundial of the Infinite' } },
    ];

    let nextTurnCalled = false;
    (game as any).nextTurn = () => {
      nextTurnCalled = true;
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerSundialHandlers(io as any, socket as any);

    await handlers['sundialActivate']({ gameId, action: 'endTurn' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INVALID_ACTION');
    expect(nextTurnCalled).toBe(false);
  });

  it('rejects sundialActivate when Sundial is tapped', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).priority = p1;
    (game.state as any).manaPool = { [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 } };
    (game.state as any).battlefield = [
      { id: 'perm1', controller: p1, tapped: true, card: { name: 'Sundial of the Infinite' } },
    ];

    let nextTurnCalled = false;
    (game as any).nextTurn = () => {
      nextTurnCalled = true;
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerSundialHandlers(io as any, socket as any);

    await handlers['sundialActivate']({ gameId, action: 'endTurn' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INVALID_ACTION');
    expect(nextTurnCalled).toBe(false);
  });

  it('allows sundialActivate when player controls untapped Sundial, has priority, and can pay {1}', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).priority = p1;
    (game.state as any).manaPool = { [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 } };
    (game.state as any).battlefield = [
      { id: 'perm1', controller: p1, tapped: false, card: { name: 'Sundial of the Infinite' } },
    ];

    let nextTurnCalled = false;
    (game as any).nextTurn = () => {
      nextTurnCalled = true;
    };
    (game as any).exileStack = () => 0;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerSundialHandlers(io as any, socket as any);

    await handlers['sundialActivate']({ gameId, action: 'endTurn' });

    const err = emitted.find(e => e.event === 'error');
    expect(err).toBeUndefined();
    expect(nextTurnCalled).toBe(true);

    const pool = (game.state as any).manaPool?.[p1];
    expect(pool?.colorless).toBe(0);
    expect(((game.state as any).battlefield?.[0] as any)?.tapped).toBe(true);
  });

  it('does not throw when payload is missing (crash-safety)', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: 'p1', gameId }, emitted);
    const io = createMockIo(emitted);
    registerSundialHandlers(io as any, socket as any);

    await expect(Promise.resolve().then(() => handlers['sundialActivate'](undefined as any))).resolves.toBeUndefined();
  });
});
