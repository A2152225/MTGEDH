import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
  } as any;
}

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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
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

describe('cancelResolutionStep authorization (integration)', () => {
  const gameId = 'test_cancel_resolution_step_authorization';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it("does not allow a different player to cancel someone else's pending step", async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1 as any,
      description: 'Choose one option',
      mandatory: false,
      options: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'option_choice');
    expect(step).toBeDefined();
    const stepId = String((step as any).id);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: socketP1, handlers: handlersP1 } = createMockSocket(p1, emitted);
    const { socket: socketP2, handlers: handlersP2 } = createMockSocket(p2, emitted);
    socketP1.rooms.add(gameId);
    socketP2.rooms.add(gameId);

    const io = createMockIo(emitted, [socketP1, socketP2]);
    registerResolutionHandlers(io as any, socketP1 as any);
    registerResolutionHandlers(io as any, socketP2 as any);

    await handlersP2['cancelResolutionStep']({ gameId, stepId });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_YOUR_STEP');

    const queueAfterBadCancel = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterBadCancel.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    await handlersP1['cancelResolutionStep']({ gameId, stepId });

    const queueAfterOkCancel = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterOkCancel.steps.some((s: any) => String(s.id) === stepId)).toBe(false);
  });

  it('does not allow a spectator seat to cancel their own pending step', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const spectatorId = 'spectator';
    (game.state as any).players = [
      { id: spectatorId, name: 'Spectator', isSpectator: true, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [spectatorId]: 40 };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: spectatorId as any,
      description: 'Choose one option',
      mandatory: false,
      options: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'option_choice');
    expect(step).toBeDefined();
    const stepId = String((step as any).id);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(spectatorId, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['cancelResolutionStep']({ gameId, stepId });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_AUTHORIZED');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);
  });

  it('does not throw when payload is missing (crash-safety)', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    expect(() => handlers['getResolutionQueue'](undefined as any)).not.toThrow();
    expect(() => handlers['getMyNextResolutionStep'](undefined as any)).not.toThrow();
    expect(() => handlers['cancelResolutionStep'](undefined as any)).not.toThrow();
    await expect(Promise.resolve().then(() => handlers['submitResolutionResponse'](undefined as any))).resolves.toBeUndefined();
  });

  it('rejects malformed stepId types for resolution actions', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: { bad: true } as any,
      selections: [],
      cancelled: false,
    });

    await handlers['cancelResolutionStep']({
      gameId,
      stepId: 123 as any,
    });

    const submitErr = emitted.find(
      e => e.event === 'error' && e.payload?.code === 'STEP_NOT_FOUND'
    );
    expect(submitErr).toBeDefined();

    const allStepNotFound = emitted.filter(
      e => e.event === 'error' && e.payload?.code === 'STEP_NOT_FOUND'
    );
    expect(allStepNotFound.length).toBeGreaterThanOrEqual(2);
  });
});
