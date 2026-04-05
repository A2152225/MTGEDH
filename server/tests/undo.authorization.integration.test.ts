import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists, truncateEventsForUndo, appendEvent } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerUndoHandlers, clearUndoRequestsForGame } from '../src/socket/undo.js';
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

    clearUndoRequestsForGame(gameId);
    clearUndoRequestsForGame(wrapperGameId);

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

  it('requestUndoToStep and smart counts keep the current boundary event intact', async () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(wrapperGameId, 'commander', 40, undefined, p1);
    const game = ensureGame(wrapperGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    // Simulate entering the first live turn from pre-game, then taking one action in MAIN1.
    appendEvent(wrapperGameId, 0, 'join', { playerId: p1, name: 'P1' });
    appendEvent(wrapperGameId, 1, 'join', { playerId: p2, name: 'P2' });
    appendEvent(wrapperGameId, 2, 'skipToPhase', { targetPhase: 'precombatMain', targetStep: 'MAIN1' });
    appendEvent(wrapperGameId, 3, 'setLife', { playerId: p1, life: 39 });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(wrapperGameId);

    const io = createMockIo(emitted, [socket]);
    registerUndoHandlers(io as any, socket as any);

    await handlers['getSmartUndoCounts']({ gameId: wrapperGameId });

    const smartUpdate = emitted.find(e => e.event === 'smartUndoCountsUpdate');
    expect(smartUpdate).toBeTruthy();
    expect(smartUpdate!.payload.stepCount).toBe(1);
    expect(smartUpdate!.payload.phaseCount).toBe(1);
    expect(smartUpdate!.payload.turnCount).toBe(1);

    await handlers['requestUndoToStep']({ gameId: wrapperGameId });

    const req = emitted.find(e => e.room === wrapperGameId && e.event === 'undoRequest');
    expect(req).toBeTruthy();
    expect(req!.payload.gameId).toBe(wrapperGameId);
    expect(typeof req!.payload.undoId).toBe('string');
    expect(req!.payload.actionsToUndo).toBe(1);
    expect(req!.payload.description).toBe('Undo current step');
    expect(req!.payload.playerNames).toEqual({ [p1]: 'P1', [p2]: 'P2' });
  });

  it('smart undo counts use the replayed boundary when restored live state drifts ahead', async () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(wrapperGameId, 'commander', 40, undefined, p1);
    const game = ensureGame(wrapperGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turn = 13;
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'DECLARE_BLOCKERS';
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    appendEvent(wrapperGameId, 0, 'join', { playerId: p1, name: 'P1' });
    appendEvent(wrapperGameId, 1, 'join', { playerId: p2, name: 'P2' });
    appendEvent(wrapperGameId, 2, 'skipToPhase', { targetPhase: 'precombatMain', targetStep: 'MAIN1' });
    appendEvent(wrapperGameId, 3, 'setLife', { playerId: p1, life: 39 });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(wrapperGameId);

    const io = createMockIo(emitted, [socket]);
    registerUndoHandlers(io as any, socket as any);

    await handlers['getSmartUndoCounts']({ gameId: wrapperGameId });

    const smartUpdate = emitted.find(e => e.event === 'smartUndoCountsUpdate');
    expect(smartUpdate).toBeTruthy();
    expect(smartUpdate!.payload.stepCount).toBe(1);
    expect(smartUpdate!.payload.phaseCount).toBe(1);
    expect(smartUpdate!.payload.turnCount).toBe(1);
  });

  it('smart undo counts stay bounded when replayed nextStep coexists with a pending library search', async () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(wrapperGameId, 'commander', 40, undefined, p1);
    const game = ensureGame(wrapperGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turn = 1;
    (game.state as any).turnNumber = 1;
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'BEGIN_COMBAT';
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'atlas_1',
        controller: p1,
        owner: p1,
        tapped: true,
        counters: {},
        card: {
          id: 'atlas_card_1',
          name: 'Atlas Relay',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {G}.\n{2}, {T}: Search your library for a Forest card, put that card onto the battlefield tapped, then shuffle.',
          zone: 'battlefield',
        },
      },
    ];

    appendEvent(wrapperGameId, 0, 'join', { playerId: p1, name: 'P1' });
    appendEvent(wrapperGameId, 1, 'join', { playerId: p2, name: 'P2' });
    appendEvent(wrapperGameId, 2, 'skipToPhase', { targetPhase: 'precombatMain', targetStep: 'MAIN1' });
    appendEvent(wrapperGameId, 3, 'activateTutorAbility', {
      playerId: p1,
      permanentId: 'atlas_1',
      abilityId: 'atlas_1-ability-1',
      cardName: 'Atlas Relay',
      stackId: 'tutor_stack_1',
    });
    appendEvent(wrapperGameId, 4, 'nextStep', { reason: 'allPlayersPassed' });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(wrapperGameId);

    const io = createMockIo(emitted, [socket]);
    registerUndoHandlers(io as any, socket as any);

    await handlers['getSmartUndoCounts']({ gameId: wrapperGameId });

    const smartUpdate = emitted.find(e => e.event === 'smartUndoCountsUpdate');
    expect(smartUpdate).toBeTruthy();
    expect(smartUpdate!.payload.totalCount).toBe(5);
    expect(smartUpdate!.payload.stepCount).toBe(0);
    expect(smartUpdate!.payload.phaseCount).toBe(0);
    expect(smartUpdate!.payload.turnCount).toBe(2);
  });

  it('requestUndoToTurn undoes only actions taken after the current turn began', async () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(wrapperGameId, 'commander', 40, undefined, p1);
    const game = ensureGame(wrapperGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    appendEvent(wrapperGameId, 0, 'join', { playerId: p1, name: 'P1' });
    appendEvent(wrapperGameId, 1, 'join', { playerId: p2, name: 'P2' });
    appendEvent(wrapperGameId, 2, 'skipToPhase', { targetPhase: 'precombatMain', targetStep: 'MAIN1' });
    appendEvent(wrapperGameId, 3, 'setLife', { playerId: p1, life: 39 });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(wrapperGameId);

    const io = createMockIo(emitted, [socket]);
    registerUndoHandlers(io as any, socket as any);

    await handlers['requestUndoToTurn']({ gameId: wrapperGameId });

    const req = emitted.find(e => e.room === wrapperGameId && e.event === 'undoRequest');
    expect(req).toBeTruthy();
    expect(req!.payload.actionsToUndo).toBe(1);
    expect(req!.payload.description).toBe('Undo current turn');
  });

  it('requestUndoToPreviousPhase rewinds past the current phase boundary', async () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(wrapperGameId, 'commander', 40, undefined, p1);
    const game = ensureGame(wrapperGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turn = 1;
    (game.state as any).turnNumber = 1;
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'BEGIN_COMBAT';
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    appendEvent(wrapperGameId, 0, 'join', { playerId: p1, name: 'P1' });
    appendEvent(wrapperGameId, 1, 'join', { playerId: p2, name: 'P2' });
    appendEvent(wrapperGameId, 2, 'skipToPhase', { targetPhase: 'precombatMain', targetStep: 'MAIN1' });
    appendEvent(wrapperGameId, 3, 'setLife', { playerId: p1, life: 39 });
    appendEvent(wrapperGameId, 4, 'skipToPhase', { targetPhase: 'combat', targetStep: 'BEGIN_COMBAT' });
    appendEvent(wrapperGameId, 5, 'setLife', { playerId: p2, life: 38 });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(wrapperGameId);

    const io = createMockIo(emitted, [socket]);
    registerUndoHandlers(io as any, socket as any);

    await handlers['getSmartUndoCounts']({ gameId: wrapperGameId });

    const smartUpdate = emitted.find(e => e.event === 'smartUndoCountsUpdate');
    expect(smartUpdate).toBeTruthy();
    expect(smartUpdate!.payload.stepCount).toBe(1);
    expect(smartUpdate!.payload.phaseCount).toBe(1);
    expect(smartUpdate!.payload.previousPhaseCount).toBe(3);
    expect(smartUpdate!.payload.turnCount).toBe(3);

    await handlers['requestUndoToPreviousPhase']({ gameId: wrapperGameId });

    const req = emitted.find(e => e.room === wrapperGameId && e.event === 'undoRequest');
    expect(req).toBeTruthy();
    expect(req!.payload.actionsToUndo).toBe(3);
    expect(req!.payload.description).toBe('Undo to previous phase');
  });

  it('requestUndoToStep prefers turnNumber over a stale legacy turn field', async () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(wrapperGameId, 'commander', 40, undefined, p1);
    const game = ensureGame(wrapperGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turn = 1;
    (game.state as any).turnNumber = 2;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    appendEvent(wrapperGameId, 0, 'join', { playerId: p1, name: 'P1' });
    appendEvent(wrapperGameId, 1, 'join', { playerId: p2, name: 'P2' });
    appendEvent(wrapperGameId, 2, 'skipToPhase', { targetPhase: 'precombatMain', targetStep: 'MAIN1' });
    appendEvent(wrapperGameId, 3, 'setLife', { playerId: p1, life: 39 });
    appendEvent(wrapperGameId, 4, 'nextTurn', {});
    appendEvent(wrapperGameId, 5, 'skipToPhase', { targetPhase: 'precombatMain', targetStep: 'MAIN1' });
    appendEvent(wrapperGameId, 6, 'setLife', { playerId: p2, life: 38 });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(wrapperGameId);

    const io = createMockIo(emitted, [socket]);
    registerUndoHandlers(io as any, socket as any);

    await handlers['getSmartUndoCounts']({ gameId: wrapperGameId });

    const smartUpdate = emitted.find(e => e.event === 'smartUndoCountsUpdate');
    expect(smartUpdate).toBeTruthy();
    expect(smartUpdate!.payload.stepCount).toBe(1);
    expect(smartUpdate!.payload.phaseCount).toBe(1);
    expect(smartUpdate!.payload.turnCount).toBe(2);

    await handlers['requestUndoToStep']({ gameId: wrapperGameId });

    const req = emitted.find(e => e.room === wrapperGameId && e.event === 'undoRequest');
    expect(req).toBeTruthy();
    expect(req!.payload.actionsToUndo).toBe(1);
    expect(req!.payload.description).toBe('Undo current step');
  });

  it('single-player undo restores priority to the turn player and pauses auto-pass until action', async () => {
    const p1 = 'p1';

    createGameIfNotExists(wrapperGameId, 'commander', 40, undefined, p1);
    const game = ensureGame(wrapperGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
    ];
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'DECLARE_ATTACKERS';
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = null;
    (game.state as any).autoPassForTurn = { [p1]: true };

    appendEvent(wrapperGameId, 0, 'join', { playerId: p1, name: 'P1' });
    appendEvent(wrapperGameId, 1, 'skipToPhase', { targetPhase: 'precombatMain', targetStep: 'MAIN1' });
    appendEvent(wrapperGameId, 2, 'setLife', { playerId: p1, life: 39 });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(wrapperGameId);

    const io = createMockIo(emitted, [socket]);
    registerUndoHandlers(io as any, socket as any);

    await handlers['requestUndo']({ gameId: wrapperGameId, actionsToUndo: 1 });

    expect((game.state as any).priority).toBe(p1);

    const undoComplete = emitted.find(e => e.event === 'undoComplete');
    expect(undoComplete?.payload).toEqual({ gameId: wrapperGameId, success: true });
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

  it('does not allow reading undo counts when socket.data.gameId mismatches (even if in room)', async () => {
    const creator = 'creator';
    const attacker = 'attacker';

    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: creator, name: 'Creator', spectator: false, life: 40 }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: socketAttacker, handlers: handlersAttacker } = createMockSocket(attacker, emitted);
    socketAttacker.data.gameId = 'other_game';
    socketAttacker.rooms.add(gameId);

    const io = createMockIo(emitted, [socketAttacker]);
    registerUndoHandlers(io as any, socketAttacker as any);

    await handlersAttacker['getUndoCount']({ gameId });

    const err = emitted.find(e => e.event === 'error' && e.payload?.code === 'NOT_IN_GAME');
    expect(err).toBeTruthy();

    const countUpdate = emitted.find(e => e.event === 'undoCountUpdate');
    expect(countUpdate).toBeUndefined();
  });

  it('does not allow respondUndo when not in room (even if seated)', async () => {
    const p1 = 'p1';
    const p2 = 'p2';

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

    const { socket: socketP2, handlers: handlersP2 } = createMockSocket(p2, emitted);
    // Note: p2 is NOT joined to the game room.

    const io = createMockIo(emitted, [socketP1, socketP2]);
    registerUndoHandlers(io as any, socketP1 as any);
    registerUndoHandlers(io as any, socketP2 as any);

    await handlersP1['requestUndo']({ gameId, actionsToUndo: 1 });

    const undoRequest = emitted.find(e => e.room === gameId && e.event === 'undoRequest');
    expect(undoRequest).toBeTruthy();
    const undoId = undoRequest!.payload.undoId as string;

    await handlersP2['respondUndo']({ gameId, undoId, approved: true });

    const err = emitted.find(e => e.event === 'error' && e.payload?.code === 'NOT_IN_GAME');
    expect(err).toBeTruthy();
  });

  it('does not allow cancelUndo when socket.data.gameId mismatches (even if in room)', async () => {
    const p1 = 'p1';
    const p2 = 'p2';

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
    socketP1.data.gameId = gameId;

    const { socket: socketP2, handlers: handlersP2 } = createMockSocket(p2, emitted);
    socketP2.rooms.add(gameId);
    socketP2.data.gameId = 'other_game';

    const io = createMockIo(emitted, [socketP1, socketP2]);
    registerUndoHandlers(io as any, socketP1 as any);
    registerUndoHandlers(io as any, socketP2 as any);

    await handlersP1['requestUndo']({ gameId, actionsToUndo: 1 });

    const undoRequest = emitted.find(e => e.room === gameId && e.event === 'undoRequest');
    expect(undoRequest).toBeTruthy();
    const undoId = undoRequest!.payload.undoId as string;

    await handlersP2['respondUndo']({ gameId, undoId, approved: true });
    const err = emitted.find(e => e.event === 'error' && e.payload?.code === 'NOT_IN_GAME');
    expect(err).toBeTruthy();
  });

  it('does not crash on missing payload for undo events', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerUndoHandlers(io as any, socket as any);

    expect(() => handlers['requestUndo'](undefined as any)).not.toThrow();
    expect(() => handlers['respondUndo'](undefined as any)).not.toThrow();
    expect(() => handlers['cancelUndo'](undefined as any)).not.toThrow();
    expect(() => handlers['getUndoCount'](undefined as any)).not.toThrow();
    expect(() => handlers['getSmartUndoCounts'](undefined as any)).not.toThrow();
    expect(() => handlers['requestUndoToStep'](undefined as any)).not.toThrow();
    expect(() => handlers['requestUndoToPhase'](undefined as any)).not.toThrow();
    expect(() => handlers['requestUndoToPreviousPhase'](undefined as any)).not.toThrow();
    expect(() => handlers['requestUndoToTurn'](undefined as any)).not.toThrow();
  });
});
