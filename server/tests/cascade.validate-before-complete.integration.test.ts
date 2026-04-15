import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame, getEvents } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

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

describe('CASCADE validate-before-complete (integration)', () => {
  const gameId = 'test_cascade_validate_before_complete';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('does not consume the step on invalid selection', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    (game as any).libraries = new Map();
    (game as any).libraries.set(p1, []);

    (game.state as any).zones = {
      [p1]: {
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        hand: [],
        handCount: 0,
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.CASCADE,
      playerId: p1 as any,
      description: 'Cascade now',
      mandatory: true,
      effectId: 'eff_1',
      hitCard: { id: 'hit_1', name: 'Hit Card', zone: 'exile' },
      exiledCards: [{ id: 'hit_1', name: 'Hit Card', zone: 'exile' }, { id: 'ex_2', name: 'Other', zone: 'exile' }],
      manaValue: 3,
      cascadeNumber: 1,
      totalCascades: 1,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'cascade');
    expect(step).toBeDefined();

    const stepId = String((step as any).id);

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: { nope: true } });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INVALID_SELECTION');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    // Valid: decline casting.
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: 'decline' });
    const queueAfterOk = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterOk.steps.some((s: any) => String(s.id) === stepId)).toBe(false);
  });

  it('persists cascadeResolve when a cascade decision completes', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    const remainingLibrary = [{ id: 'after_1', name: 'After Card', type_line: 'Sorcery' }];
    (game as any).libraries = new Map();
    (game as any).libraries.set(p1, [...remainingLibrary]);

    (game.state as any).zones = {
      [p1]: {
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: remainingLibrary.length,
      },
    };
    (game.state as any).pendingCascade = {
      [p1]: [
        {
          sourceName: 'Bloodbraid Elf',
          sourceCardId: 'bloodbraid_elf',
          manaValue: 4,
          instance: 1,
          effectId: 'eff_persist',
          awaiting: true,
          hitCard: { id: 'hit_1', name: 'Hit Card', type_line: 'Instant', oracle_text: 'Draw a card.' },
          exiledCards: [
            { id: 'hit_1', name: 'Hit Card', type_line: 'Instant', oracle_text: 'Draw a card.' },
            { id: 'ex_2', name: 'Other', type_line: 'Sorcery', oracle_text: 'Scry 1.' },
          ],
        },
      ],
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.CASCADE,
      playerId: p1 as any,
      description: 'Cascade now',
      mandatory: true,
      sourceId: 'bloodbraid_elf',
      sourceName: 'Bloodbraid Elf',
      effectId: 'eff_persist',
      hitCard: { id: 'hit_1', name: 'Hit Card', type_line: 'Instant', oracle_text: 'Draw a card.' },
      exiledCards: [{ id: 'hit_1', name: 'Hit Card' }, { id: 'ex_2', name: 'Other' }],
      manaValue: 4,
      cascadeNumber: 1,
      totalCascades: 1,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'cascade');
    await handlers['submitResolutionResponse']({ gameId, stepId: String((step as any).id), selections: 'decline' });

    const cascadeEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'cascadeResolve') as any;
    expect(cascadeEvent).toBeDefined();
    expect(cascadeEvent.payload).toMatchObject({
      playerId: p1,
      effectId: 'eff_persist',
      sourceCardId: 'bloodbraid_elf',
      sourceName: 'Bloodbraid Elf',
      cast: false,
    });
    expect(cascadeEvent.payload.libraryAfter.map((card: any) => card.id)).toHaveLength(3);
    expect(cascadeEvent.payload.libraryAfter.map((card: any) => card.id)).toContain('after_1');
    expect(cascadeEvent.payload.libraryAfter.map((card: any) => card.id)).toContain('hit_1');
    expect(cascadeEvent.payload.libraryAfter.map((card: any) => card.id)).toContain('ex_2');
  });
});
