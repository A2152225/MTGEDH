import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
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

describe('restartGame authorization (integration)', () => {
  const gameId = 'test_restart_game_authorization';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('does not allow a non-creator to restart (does not wipe resolution queue)', async () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).phase = 'main1';

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1 as any,
      description: 'Creator choice pending',
      mandatory: false,
      options: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      minSelections: 1,
      maxSelections: 1,
    } as any);

    const beforeQueue = ResolutionQueueManager.getQueue(gameId);
    expect(beforeQueue.steps.length).toBe(1);
    const beforeStepId = String(beforeQueue.steps[0].id);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p2, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);

    await handlers['restartGame']({ gameId });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('RESTART_NOT_AUTHORIZED');

    const afterQueue = ResolutionQueueManager.getQueue(gameId);
    expect(afterQueue.steps.length).toBe(1);
    expect(String(afterQueue.steps[0].id)).toBe(beforeStepId);
    expect((game.state as any).phase).toBe('main1');
  });

  it('allows the creator to restart', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).phase = 'main1';

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);

    await handlers['restartGame']({ gameId });

    const err = emitted.find(e => e.event === 'error');
    expect(err).toBeUndefined();
    expect((game.state as any).phase).toBe('pre_game');
  });

  it('does not allow the creator to restart when not in the game room', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).phase = 'main1';

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1 as any,
      description: 'Creator choice pending',
      mandatory: false,
      options: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      minSelections: 1,
      maxSelections: 1,
    } as any);

    const beforeQueue = ResolutionQueueManager.getQueue(gameId);
    expect(beforeQueue.steps.length).toBe(1);
    const beforeStepId = String(beforeQueue.steps[0].id);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    // Intentionally do NOT join the room.

    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);

    await handlers['restartGame']({ gameId });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('RESTART_NOT_IN_GAME');

    const afterQueue = ResolutionQueueManager.getQueue(gameId);
    expect(afterQueue.steps.length).toBe(1);
    expect(String(afterQueue.steps[0].id)).toBe(beforeStepId);
    expect((game.state as any).phase).toBe('main1');
  });

  it('does not allow the creator to restartGameClear when not in the game room', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).phase = 'main1';

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    // Intentionally do NOT join the room.

    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);

    await handlers['restartGameClear']({ gameId });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('RESTART_NOT_IN_GAME');
    expect((game.state as any).phase).toBe('main1');
  });
});
