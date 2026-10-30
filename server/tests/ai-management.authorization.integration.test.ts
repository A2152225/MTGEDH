import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { cleanupGameAI, isAIPlayer, registerAIHandlers, registerAIPlayer } from '../src/socket/ai.js';
import { checkAndTriggerAI, ensureGame } from '../src/socket/util.js';
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

  async function resetGame(gameId: string) {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    cleanupGameAI(gameId);
    await resetGame(gameId);
  });

  afterEach(async () => {
    cleanupGameAI(gameId);
    await resetGame(gameId);
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
    (game.state as any).phase = 'PRE_GAME';

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

  it('allows creator to remove an AI during pre-game', async () => {
    const creator = 'p1';
    const aiId = 'ai_remove_me';

    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: creator, name: 'P1', spectator: false, life: 40 },
      { id: aiId, name: 'AI Opponent', spectator: false, life: 40, isAI: true },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [creator]: 40, [aiId]: 40 };
    (game.state as any).phase = 'PRE_GAME';

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(creator, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerAIHandlers(io as any, socket as any);

    await handlers['removeAIFromGame']({ gameId, aiPlayerId: aiId });

    const err = emitted.find(e => e.event === 'error');
    expect(err).toBeUndefined();
    expect((game.state as any).players.some((p: any) => p?.id === aiId)).toBe(false);
    expect(emitted.find(e => e.event === 'aiPlayerRemoved')?.payload?.aiPlayerId).toBe(aiId);
  });

  it('rejects removeAIFromGame for a human seat', async () => {
    const creator = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: creator, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [creator]: 40 };
    (game.state as any).phase = 'PRE_GAME';

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(creator, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerAIHandlers(io as any, socket as any);

    await handlers['removeAIFromGame']({ gameId, aiPlayerId: creator });
    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('AI_NOT_FOUND');
    expect((game.state as any).players.length).toBe(1);
  });

  it('rejects removeAIFromGame after the game has left pre-game', async () => {
    const creator = 'p1';
    const aiId = 'ai_stuck';

    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: creator, name: 'P1', spectator: false, life: 40 },
      { id: aiId, name: 'AI Opponent', spectator: false, life: 40, isAI: true },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [creator]: 40, [aiId]: 40 };
    (game.state as any).phase = 'precombatMain';

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(creator, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerAIHandlers(io as any, socket as any);

    await handlers['removeAIFromGame']({ gameId, aiPlayerId: aiId });
    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('AI_NOT_PREGAME');
    expect((game.state as any).players.some((p: any) => p?.id === aiId)).toBe(true);
  });

  it('rejects removeAIFromGame once every seated player has kept their hand', async () => {
    const creator = 'p1';
    const aiId = 'ai_kept';

    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: creator, name: 'P1', spectator: false, life: 40 },
      { id: aiId, name: 'AI Opponent', spectator: false, life: 40, isAI: true },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [creator]: 40, [aiId]: 40 };
    (game.state as any).phase = 'PRE_GAME';
    (game.state as any).mulliganState = {
      [creator]: { hasKeptHand: true, mulligansTaken: 0, pendingBottomCount: 0 },
      [aiId]: { hasKeptHand: true, mulligansTaken: 0, pendingBottomCount: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(creator, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerAIHandlers(io as any, socket as any);

    await handlers['removeAIFromGame']({ gameId, aiPlayerId: aiId });
    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('AI_HANDS_LOCKED');
    expect((game.state as any).players.some((p: any) => p?.id === aiId)).toBe(true);
  });

  it('rejects addAIToGame after the game has left pre-game', async () => {
    const creator = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: creator, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [creator]: 40 };
    (game.state as any).phase = 'precombatMain';

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(creator, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerAIHandlers(io as any, socket as any);

    const before = (game.state as any).players.length;
    await handlers['addAIToGame']({ gameId, aiName: 'AI Opponent' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('AI_NOT_PREGAME');
    expect((game.state as any).players.length).toBe(before);
  });

  it('rejects addAIToGame once every seated player has kept their hand', async () => {
    const creator = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: creator, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [creator]: 40 };
    (game.state as any).phase = 'PRE_GAME';
    (game.state as any).mulliganState = {
      [creator]: { hasKeptHand: true, mulligansTaken: 0, pendingBottomCount: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(creator, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerAIHandlers(io as any, socket as any);

    const before = (game.state as any).players.length;
    await handlers['addAIToGame']({ gameId, aiName: 'AI Opponent' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('AI_HANDS_LOCKED');
    expect((game.state as any).players.length).toBe(before);
  });

  it('rejects addAIToGame when the table is already at 10 seats', async () => {
    const creator = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, creator);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = Array.from({ length: 10 }, (_, i) => ({
      id: i === 0 ? creator : `p${i + 1}`,
      name: `P${i + 1}`,
      spectator: false,
      life: 40,
    }));
    (game.state as any).startingLife = 40;
    (game.state as any).phase = 'PRE_GAME';

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(creator, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerAIHandlers(io as any, socket as any);

    await handlers['addAIToGame']({ gameId, aiName: 'AI Opponent' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('AI_TABLE_FULL');
    expect((game.state as any).players.length).toBe(10);
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

  it('stops taking actions after a player turns autopilot off', async () => {
    const playerId = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
      { id: 'ai_opp', name: 'Bot', spectator: false, life: 40, isAI: true },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, ai_opp: 40 };
    (game.state as any).phase = 'main1';
    (game.state as any).step = 'main';
    (game.state as any).priority = playerId;
    (game.state as any).turnPlayer = playerId;
    registerAIPlayer(gameId, 'ai_opp' as any, 'Bot', 0.5);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerAIHandlers(io as any, socket as any);

    await handlers['toggleAIControl']({ gameId, enable: true, difficulty: 0.5 });
    const player = (game.state as any).players.find((p: any) => p.id === playerId);
    expect(player.isAI).toBe(true);
    expect(player.aiControlled).toBe(true);
    expect(isAIPlayer(gameId, playerId as any)).toBe(true);

    emitted.length = 0;
    await handlers['toggleAIControl']({ gameId, enable: false });

    expect(player.isAI).toBe(false);
    expect(player.aiControlled).toBe(false);
    expect(player.strategy).toBeUndefined();
    expect(isAIPlayer(gameId, playerId as any)).toBe(false);
    expect(emitted.find((e) => e.event === 'aiControlToggled')?.payload?.enabled).toBe(false);

    // The same kick broadcastGame uses after every action. A cleared seat must not come back.
    checkAndTriggerAI(io as any, game as any, gameId);
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(player.isAI).toBe(false);
    expect(isAIPlayer(gameId, playerId as any)).toBe(false);
    expect((game.state as any).autoPassPlayers?.has?.(playerId)).not.toBe(true);
    expect(isAIPlayer(gameId, 'ai_opp' as any)).toBe(true);
  });

  it('does not throw when payload is missing (crash-safety)', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', emitted);
    const io = createMockIo(emitted, [socket]);
    registerAIHandlers(io as any, socket as any);

    await expect(Promise.resolve().then(() => handlers['createGame'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['createGameWithAI'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['createGameWithMultipleAI'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['addAIToGame'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['removeAIFromGame'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['toggleAIControl'](undefined as any))).resolves.toBeUndefined();
  });

  it('rejects malformed payloads for AI management handlers', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', emitted);
    const io = createMockIo(emitted, [socket]);
    registerAIHandlers(io as any, socket as any);

    await handlers['createGame']({ gameId: 123 as any });
    await handlers['createGameWithMultipleAI']({ gameId, aiOpponents: {} as any });
    await handlers['addAIToGame']({ gameId: 123 as any });
    await handlers['removeAIFromGame']({ gameId, aiPlayerId: 123 as any });
    await handlers['toggleAIControl']({ gameId, enable: 'yes' as any });

    const createErr = emitted.find(e => e.event === 'error' && e.payload?.code === 'GAME_CREATE_FAILED');
    expect(createErr).toBeDefined();

    const addErr = emitted.find(e => e.event === 'error' && e.payload?.code === 'AI_ADD_FAILED');
    expect(addErr).toBeDefined();

    const removeErr = emitted.find(e => e.event === 'error' && e.payload?.code === 'AI_REMOVE_FAILED');
    expect(removeErr).toBeDefined();

    const toggleErr = emitted.find(e => e.event === 'error' && e.payload?.code === 'AI_TOGGLE_FAILED');
    expect(toggleErr).toBeDefined();
  });
});
