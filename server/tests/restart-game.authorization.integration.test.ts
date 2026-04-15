import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
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

  async function resetGame(gameId: string) {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
  });

  it('does not allow the creator to restart when socket.data.gameId mismatches (even if in room)', async () => {
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
    (socket.data as any).gameId = 'other_game';
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);

    await handlers['restartGame']({ gameId });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('RESTART_NOT_IN_GAME');
    expect((game.state as any).phase).toBe('main1');
  });

  beforeEach(async () => {
    await resetGame(gameId);
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

  it('fully clears gameplay state while preserving the player roster on restart', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 7 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 7 };
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'DECLARE_ATTACKERS';
    (game.state as any).turnNumber = 5;
    (game.state as any).battlefield = [{ id: 'perm_1', controller: p1, owner: p1, card: { id: 'c1', name: 'Kindred Discovery', type_line: 'Enchantment' } }];
    (game.state as any).stack = [{ id: 'stack_1', controller: p1, source: 'perm_1' }];
    (game.state as any).zones = {
      [p1]: {
        hand: [{ id: 'hand_1', name: 'Island', type_line: 'Land' }],
        handCount: 1,
        library: [{ id: 'lib_1', name: 'Forest', type_line: 'Land' }],
        libraryCount: 1,
        graveyard: [{ id: 'gy_1', name: 'Opt', type_line: 'Instant' }],
        graveyardCount: 1,
        exile: [{ id: 'ex_1', name: 'Shared Fate', type_line: 'Enchantment' }],
        exileCount: 1,
      },
    };
    (game.state as any).manaPool = { [p1]: { blue: 3, white: 0, black: 0, red: 0, green: 0, colorless: 0 } };
    (game.state as any).commandZone = { [p1]: { commanderIds: ['cmd_1'], commanderCards: [{ id: 'cmd_1', name: 'Commander' }] } };
    (game.state as any).playableFromExile = { [p1]: { ex_1: true } };
    (game.state as any).morophonChosenType = { perm_1: 'Merfolk' };
    (game.state as any).replayPermanentAliases = { old_perm: 'perm_1' };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);

    await handlers['restartGame']({ gameId });

    expect((game.state as any).phase).toBe('pre_game');
    expect((game.state as any).step).toBeUndefined();
    expect((game.state as any).turnNumber).toBeUndefined();
    expect((game.state as any).battlefield).toEqual([]);
    expect((game.state as any).stack).toEqual([]);
    expect((game.state as any).life).toEqual({ [p1]: 40 });
    expect((game.state as any).manaPool).toBeUndefined();
    expect((game.state as any).commandZone).toEqual({});
    expect((game.state as any).playableFromExile).toBeUndefined();
    expect((game.state as any).morophonChosenType).toBeUndefined();
    expect((game.state as any).replayPermanentAliases).toBeUndefined();
    expect((game.state as any).players).toHaveLength(1);
    expect((game.state as any).players[0]).toMatchObject({ id: p1, name: 'P1', life: 40 });
    expect((game.state as any).zones[p1]).toEqual({
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    });
  });

  it('clears stale cleanup discard prompts on restart', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).phase = 'ending';
    (game.state as any).step = 'CLEANUP';
    (game.state as any).zones = {
      [p1]: {
        hand: [
          { id: 'hand_1', name: 'Island', type_line: 'Land' },
          { id: 'hand_2', name: 'Forest', type_line: 'Land' },
          { id: 'hand_3', name: 'Swamp', type_line: 'Land' },
          { id: 'hand_4', name: 'Mountain', type_line: 'Land' },
          { id: 'hand_5', name: 'Plains', type_line: 'Land' },
        ],
        handCount: 5,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: p1 as any,
      description: 'Cleanup: discard 1 card(s) to maximum hand size (7).',
      sourceName: 'Cleanup Step',
      mandatory: true,
      hand: [
        { id: 'hand_1', label: 'Island' },
        { id: 'hand_2', label: 'Forest' },
        { id: 'hand_3', label: 'Swamp' },
        { id: 'hand_4', label: 'Mountain' },
        { id: 'hand_5', label: 'Plains' },
      ],
      discardCount: 1,
      currentHandSize: 5,
      maxHandSize: 7,
      reason: 'cleanup',
    } as any);

    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p1 as any)).toHaveLength(1);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);

    await handlers['restartGame']({ gameId });

    expect((game.state as any).phase).toBe('pre_game');
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p1 as any)).toHaveLength(0);
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
