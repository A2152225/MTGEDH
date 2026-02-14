import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists, truncateEventsForUndo, appendEvent } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerUndoHandlers } from '../src/socket/undo.js';
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

describe('undo authorization (integration)', () => {
  const gameId = 'test_undo_authorization';
  const wrapperGameId = 'test_undo_authorization_wrapper';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
    games.delete(wrapperGameId as any);
    try {
      truncateEventsForUndo(gameId, 0);
    } catch {
      // ignore
    }

    try {
      truncateEventsForUndo(wrapperGameId, 0);
    } catch {
      // ignore
    }
  });

  it('does not allow a non-participant to reject an undo request', async () => {
    const p1 = 'p1';
    const p2 = 'p2';
    const attacker = 'attacker';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];

    const { socket: socketP1, handlers: handlersP1 } = createMockSocket(p1, emitted);
    socketP1.rooms.add(gameId);

    const { socket: socketAttacker, handlers: handlersAttacker } = createMockSocket(attacker, emitted);
    socketAttacker.rooms.add(gameId);

    const io = createMockIo(emitted, [socketP1, socketAttacker]);
    registerUndoHandlers(io as any, socketP1 as any);
    registerUndoHandlers(io as any, socketAttacker as any);

    await handlersP1['requestUndo']({ gameId, actionsToUndo: 1 });

    const undoRequest = emitted.find(e => e.room === gameId && e.event === 'undoRequest');
    expect(undoRequest).toBeTruthy();
    const undoId = undoRequest!.payload.undoId as string;
    expect(typeof undoId).toBe('string');

    await handlersAttacker['respondUndo']({ gameId, undoId, approved: false });

    const attackerErr = emitted.find(e => e.event === 'error' && e.payload?.code === 'NOT_IN_GAME');
    expect(attackerErr).toBeTruthy();

    const cancelled = emitted.find(e => e.room === gameId && e.event === 'undoCancelled');
    expect(cancelled).toBeUndefined();
  });

  it('does not allow a non-participant to request an undo', async () => {
    const creator = 'creator';
    const attacker = 'attacker';

    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: creator, name: 'Creator', spectator: false, life: 40 }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];

    const { socket: socketAttacker, handlers: handlersAttacker } = createMockSocket(attacker, emitted);
    socketAttacker.rooms.add(gameId);

    const io = createMockIo(emitted, [socketAttacker]);
    registerUndoHandlers(io as any, socketAttacker as any);

    await handlersAttacker['requestUndo']({ gameId, actionsToUndo: 1 });

    const attackerErr = emitted.find(e => e.event === 'error' && e.payload?.code === 'NOT_IN_GAME');
    expect(attackerErr).toBeTruthy();

    const undoRequest = emitted.find(e => e.room === gameId && e.event === 'undoRequest');
    expect(undoRequest).toBeUndefined();
  });

  it('requestUndoToStep initiates an undo request server-side', async () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(wrapperGameId, 'commander', 40, undefined, p1);
    const game = ensureGame(wrapperGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];

    // Add at least one step-change event so calculateUndoToStep returns > 0.
    appendEvent(wrapperGameId, 0, 'drawCards', { playerId: p1, n: 1 });
    appendEvent(wrapperGameId, 1, 'nextStep', { step: 'combat_begin' });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(wrapperGameId);

    const io = createMockIo(emitted, [socket]);
    registerUndoHandlers(io as any, socket as any);

    await handlers['requestUndoToStep']({ gameId: wrapperGameId });

    const req = emitted.find(e => e.room === wrapperGameId && e.event === 'undoRequest');
    expect(req).toBeTruthy();
    expect(req!.payload.gameId).toBe(wrapperGameId);
    expect(typeof req!.payload.undoId).toBe('string');
    expect(req!.payload.actionsToUndo).toBe(1);
  });

  it('does not allow a non-participant to read undo counts', async () => {
    const creator = 'creator';
    const attacker = 'attacker';

    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: creator, name: 'Creator', spectator: false, life: 40 }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: socketAttacker, handlers: handlersAttacker } = createMockSocket(attacker, emitted);

    // Note: attacker is NOT joined to the game room.
    const io = createMockIo(emitted, [socketAttacker]);
    registerUndoHandlers(io as any, socketAttacker as any);

    await handlersAttacker['getUndoCount']({ gameId });
    await handlersAttacker['getSmartUndoCounts']({ gameId });

    const err = emitted.find(e => e.event === 'error' && e.payload?.code === 'NOT_IN_GAME');
    expect(err).toBeTruthy();

    const countUpdate = emitted.find(e => e.event === 'undoCountUpdate');
    expect(countUpdate).toBeUndefined();

    const smartUpdate = emitted.find(e => e.event === 'smartUndoCountsUpdate');
    expect(smartUpdate).toBeUndefined();
  });
});
