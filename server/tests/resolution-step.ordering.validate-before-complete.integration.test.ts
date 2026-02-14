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
    rooms: { has: (_room: string) => true, add: (_room: string) => {}, delete: (_room: string) => {} } as any,
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('Resolution step ordering (integration)', () => {
  const gameId = 'test_resolution_step_ordering_validate_before_complete';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('does not allow completing a later pending step for the same player', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1 as any,
      description: 'First choice',
      mandatory: false,
      options: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      minSelections: 1,
      maxSelections: 1,
    } as any);

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1 as any,
      description: 'Second choice',
      mandatory: false,
      options: [
        { id: 'x', name: 'X' },
        { id: 'y', name: 'Y' },
      ],
      minSelections: 1,
      maxSelections: 1,
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(2);

    const firstId = String(queue.steps[0].id);
    const secondId = String(queue.steps[1].id);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: secondId, selections: 'x' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('STEP_OUT_OF_ORDER');

    const queueAfterBad = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterBad.steps.map((s: any) => String(s.id))).toEqual([firstId, secondId]);

    emitted.length = 0;
    await handlers['submitResolutionResponse']({ gameId, stepId: firstId, selections: 'a' });

    const queueAfterFirst = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterFirst.steps.map((s: any) => String(s.id))).toEqual([secondId]);

    emitted.length = 0;
    await handlers['submitResolutionResponse']({ gameId, stepId: secondId, selections: 'x' });

    const queueAfterSecond = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterSecond.steps.length).toBe(0);
  });

  it('does not allow cancelling a later pending step for the same player', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1 as any,
      description: 'First choice',
      mandatory: false,
      options: [{ id: 'a', name: 'A' }],
      minSelections: 1,
      maxSelections: 1,
    } as any);

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1 as any,
      description: 'Second choice',
      mandatory: false,
      options: [{ id: 'x', name: 'X' }],
      minSelections: 1,
      maxSelections: 1,
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const firstId = String(queue.steps[0].id);
    const secondId = String(queue.steps[1].id);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['cancelResolutionStep']({ gameId, stepId: secondId });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('STEP_OUT_OF_ORDER');

    const queueAfterBad = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterBad.steps.map((s: any) => String(s.id))).toEqual([firstId, secondId]);

    emitted.length = 0;
    await handlers['cancelResolutionStep']({ gameId, stepId: firstId });

    const queueAfterFirstCancel = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterFirstCancel.steps.map((s: any) => String(s.id))).toEqual([secondId]);

    emitted.length = 0;
    await handlers['cancelResolutionStep']({ gameId, stepId: secondId });

    const queueAfterSecondCancel = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterSecondCancel.steps.length).toBe(0);
  });

  it('does not allow completing a stale step after a higher-priority step is inserted ahead of it', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    // First step (lower priority = later in queue)
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1 as any,
      description: 'Original step',
      mandatory: false,
      priority: 0,
      options: [{ id: 'a', name: 'A' }],
      minSelections: 1,
      maxSelections: 1,
    } as any);

    // Insert a higher-priority step that should become the new next step
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1 as any,
      description: 'Higher priority step',
      mandatory: false,
      priority: -1,
      options: [{ id: 'x', name: 'X' }],
      minSelections: 1,
      maxSelections: 1,
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(2);

    const nextId = String(queue.steps[0].id);
    const staleId = String(queue.steps[1].id);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: staleId, selections: 'a' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('STEP_OUT_OF_ORDER');

    const queueAfterBad = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterBad.steps.map((s: any) => String(s.id))).toEqual([nextId, staleId]);

    emitted.length = 0;
    await handlers['submitResolutionResponse']({ gameId, stepId: nextId, selections: 'x' });
    const queueAfterNext = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterNext.steps.map((s: any) => String(s.id))).toEqual([staleId]);

    emitted.length = 0;
    await handlers['submitResolutionResponse']({ gameId, stepId: staleId, selections: 'a' });
    const queueAfterStale = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterStale.steps.length).toBe(0);
  });
});
