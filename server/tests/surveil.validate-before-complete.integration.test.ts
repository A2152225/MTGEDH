import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame, getEvents } from '../src/db/index.js';
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('SURVEIL validate-before-complete (integration)', () => {
  const gameId = 'test_surveil_validate_before_complete';

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

    const libCards = [
      { id: 'c1', name: 'Card 1', zone: 'library' },
      { id: 'c2', name: 'Card 2', zone: 'library' },
    ];
    (game as any).libraries?.set?.(p1, libCards.slice());

    (game.state as any).zones = {
      [p1]: {
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        hand: [],
        handCount: 0,
        libraryCount: libCards.length,
      },
    };
    (game.state as any).battlefield = [];

    const stepCards = libCards.map(c => ({ id: c.id, name: c.name }));

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.SURVEIL,
      playerId: p1 as any,
      description: 'Surveil 2',
      mandatory: true,
      surveilCount: 2,
      cards: stepCards,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'surveil');
    expect(step).toBeDefined();

    const stepId = String((step as any).id);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId,
      selections: { keepTopOrder: ['c1'], toGraveyard: [] },
    });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INVALID_SELECTION');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId,
      selections: { keepTopOrder: ['c1'], toGraveyard: ['c2'] },
    });

    const queueAfterOk = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterOk.steps.some((s: any) => String(s.id) === stepId)).toBe(false);
  });

  it('persists follow-up graveyard exile prompts created after surveil resolves', async () => {
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

    const libCards = [
      { id: 'c1', name: 'Card 1', zone: 'library' },
      { id: 'c2', name: 'Card 2', zone: 'library' },
    ];
    (game as any).libraries?.set?.(p1, libCards.slice());

    (game.state as any).zones = {
      [p1]: {
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        hand: [],
        handCount: 0,
        libraryCount: libCards.length,
      },
      [p2]: {
        graveyard: [{ id: 'g_opponent', name: 'Dead Card', type_line: 'Creature', zone: 'graveyard' }],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        hand: [],
        handCount: 0,
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [];

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.SURVEIL,
      playerId: p1 as any,
      description: 'Test Walker: Surveil 2',
      mandatory: true,
      sourceId: 'walker_1',
      sourceName: 'Test Walker',
      surveilCount: 2,
      cards: libCards.map((card) => ({ id: card.id, name: card.name })),
      followUpExileGraveyardCard: true,
      followUpSourceName: 'Test Walker',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: { keepTopOrder: ['c2'], toGraveyard: ['c1'] },
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const followUpStep = queue.steps[0] as any;
    expect(followUpStep.type).toBe('target_selection');
    expect(followUpStep.action).toBe('exile_graveyard_card');
    expect((followUpStep.validTargets || []).map((target: any) => String(target.id))).toEqual(['c1', 'g_opponent']);

    const promptEvents = getEvents(gameId).filter((event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt') as any[];
    const promptEvent = promptEvents[promptEvents.length - 1];
    expect(promptEvent?.payload?.sourceId).toBe('walker_1');
    expect(promptEvent?.payload?.queuedResolutionStep?.type).toBe('target_selection');
    expect(promptEvent?.payload?.queuedResolutionStep?.action).toBe('exile_graveyard_card');
  });
});
