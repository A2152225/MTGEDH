import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerJudgeHandlers } from '../src/socket/judge.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

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

function createMockSocket(data: any, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
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

describe('judge request authorization (integration)', () => {
  const gameId = 'test_judge_request_auth';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('blocks requestJudge when socket is not in the game room', async () => {
    const p1 = 'p1';

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    // Intentionally do NOT join the room.

    const io = createMockIo(emitted);
    registerJudgeHandlers(io as any, socket as any);

    await handlers['requestJudge']({ gameId });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');
  });

  it('blocks requestJudge when socket.data.gameId mismatches (even if in room)', async () => {
    const p1 = 'p1';

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId: 'other_game' }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerJudgeHandlers(io as any, socket as any);

    await handlers['requestJudge']({ gameId });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');
  });

  it('enqueues judge vote steps when caller is in-room', async () => {
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
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerJudgeHandlers(io as any, socket as any);

    await handlers['requestJudge']({ gameId });

    const err = emitted.find(e => e.event === 'error');
    expect(err).toBeUndefined();

    const systemChat = emitted.find(e => e.room === gameId && e.event === 'chat');
    expect(systemChat?.payload?.from).toBe('system');

    const queue = ResolutionQueueManager.getQueue(gameId);
    const judgeSteps = queue.steps.filter((s: any) => (s as any)?.judgeConfirm === true);
    expect(judgeSteps.length).toBe(1);
    expect((judgeSteps[0] as any).playerId).toBe(p2);

    // Prevent the test run from keeping an active timeout.
    const timeout = (game as any)?._judgeRuntime?.currentVote?.timeout;
    if (timeout) {
      try {
        clearTimeout(timeout);
      } catch {
        // ignore
      }
    }
  });

  it('does not throw when payload is missing (crash-safety)', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: 'p1', spectator: false, gameId }, emitted);

    const io = createMockIo(emitted);
    registerJudgeHandlers(io as any, socket as any);

    expect(() => handlers['requestJudge'](undefined as any)).not.toThrow();
  });
});
