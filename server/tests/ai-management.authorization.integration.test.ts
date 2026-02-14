import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerAIHandlers } from '../src/socket/ai.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

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

function createMockSocket(playerId: string | undefined, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: `sock_${playerId || 'anon'}`,
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

describe('AI management authorization (integration)', () => {
  const gameId = 'test_ai_management_authorization';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('rejects createGame* when gameId already exists (prevents mutating existing game)', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);

    const io = createMockIo(emitted, [socket]);
    registerAIHandlers(io as any, socket as any);

    await handlers['createGame']({ gameId, format: 'commander', startingLife: 40 });
    const err1 = emitted.find(e => e.event === 'error');
    expect(err1?.payload?.code).toBe('GAME_ALREADY_EXISTS');

    emitted.length = 0;
    await handlers['createGameWithAI']({ gameId, playerName: 'P1', format: 'commander', startingLife: 40 });
    const err2 = emitted.find(e => e.event === 'error');
    expect(err2?.payload?.code).toBe('GAME_ALREADY_EXISTS');

    emitted.length = 0;
    await handlers['createGameWithMultipleAI']({ gameId, playerName: 'P1', format: 'commander', startingLife: 40, aiOpponents: [] });
    const err3 = emitted.find(e => e.event === 'error');
    expect(err3?.payload?.code).toBe('GAME_ALREADY_EXISTS');
  });

  it('does not allow non-creator to add/remove AI (does not wipe resolution queue)', async () => {
    const creator = 'p1';
    const attacker = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: creator, name: 'P1', spectator: false, life: 40 },
      { id: attacker, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [creator]: 40, [attacker]: 40 };

    // Create a pending step for creator; this is the kind of thing a malicious reset would wipe.
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: creator as any,
      description: 'Creator pending choice',
      mandatory: false,
      options: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      minSelections: 1,
      maxSelections: 1,
    } as any);

    const stepBefore = ResolutionQueueManager.getQueue(gameId).steps[0];
    expect(stepBefore).toBeTruthy();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(attacker, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerAIHandlers(io as any, socket as any);

    const playersBefore = Array.isArray((game.state as any).players) ? (game.state as any).players.length : 0;

    await handlers['addAIToGame']({ gameId, aiName: 'BadAI' });
    const errAdd = emitted.find(e => e.event === 'error');
    expect(errAdd?.payload?.code).toBe('AI_NOT_AUTHORIZED');

    const playersAfterAdd = Array.isArray((game.state as any).players) ? (game.state as any).players.length : 0;
    expect(playersAfterAdd).toBe(playersBefore);

    emitted.length = 0;
    await handlers['removeAIFromGame']({ gameId, aiPlayerId: 'ai_fake' });
    const errRemove = emitted.find(e => e.event === 'error');
    expect(errRemove?.payload?.code).toBe('AI_NOT_AUTHORIZED');

    const stepAfter = ResolutionQueueManager.getQueue(gameId).steps[0];
    expect(stepAfter && String(stepAfter.id)).toBe(String(stepBefore.id));
  });

  it('allows creator to add AI to an existing game', async () => {
    const creator = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: creator, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [creator]: 40 };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(creator, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerAIHandlers(io as any, socket as any);

    const before = (game.state as any).players.length;
    await handlers['addAIToGame']({ gameId, aiName: 'AI Opponent' });

    const err = emitted.find(e => e.event === 'error');
    expect(err).toBeUndefined();

    const after = (game.state as any).players.length;
    expect(after).toBe(before + 1);

    const aiPlayer = (game.state as any).players.find((p: any) => p && p.isAI);
    expect(aiPlayer).toBeTruthy();
  });

  it('rejects creator addAIToGame when not in the game room', async () => {
    const creator = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: creator, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [creator]: 40 };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(creator, emitted);
    // Intentionally do NOT join the socket to the game room.

    const io = createMockIo(emitted, [socket]);
    registerAIHandlers(io as any, socket as any);

    const before = (game.state as any).players.length;
    await handlers['addAIToGame']({ gameId, aiName: 'AI Opponent' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');

    const after = (game.state as any).players.length;
    expect(after).toBe(before);
  });
});
