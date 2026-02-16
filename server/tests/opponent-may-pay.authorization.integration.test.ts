import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerOpponentMayPayHandlers } from '../src/socket/opponent-may-pay.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
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

describe('opponent-may-pay authorization (integration)', () => {
  const gameId = 'test_opponent_may_pay_auth';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('does not allow a non-judge to emitOpponentMayPayPrompt', async () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).manaPool = { [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerOpponentMayPayHandlers(io as any, socket as any);

    await handlers['emitOpponentMayPayPrompt']({
      gameId,
      promptId: 'prompt_1',
      sourceName: 'Smothering Tithe',
      sourceController: p1,
      decidingPlayer: p2,
      manaCost: '{2}',
      declineEffect: 'Create a Treasure token.',
      triggerText: 'Test trigger',
    });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_AUTHORIZED');

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(0);
  });

  it('does not throw on missing payload and ignores malformed shortcut payloads', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerOpponentMayPayHandlers(io as any, socket as any);

    expect(() => handlers['emitOpponentMayPayPrompt'](undefined as any)).not.toThrow();
    expect(() => handlers['setOpponentMayPayShortcut'](undefined as any)).not.toThrow();

    await handlers['setOpponentMayPayShortcut']({ gameId, sourceName: 'Rhystic Study', preference: 'bad_value' as any });

    const chats = emitted.filter(e => e.event === 'chat');
    expect(chats.length).toBe(0);
  });
});
