import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
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

describe('scry followup choice (integration)', () => {
  const gameId = 'test_scry_followup_choice';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  function setupGame() {
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
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 2 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    };
    const libCards = [
      { id: 'c1', name: 'Card 1', zone: 'library' },
      { id: 'c2', name: 'Card 2', zone: 'library' },
    ];
    (game as any).libraries?.set?.(p1, libCards.slice());
    (game as any)._fallbackLibraries = {
      ...(game as any)._fallbackLibraries,
      [p1]: libCards.slice(),
      [p2]: [],
    };
    (game.state as any).zones[p1].library = libCards.slice();
    (game.state as any).battlefield = [];

    return { game, p1, p2, libCards };
  }

  it('applies damage to each opponent after scry resolves', async () => {
    const { game, p1, p2, libCards } = setupGame();

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.SCRY,
      playerId: p1 as any,
      description: 'Source: Scry 2',
      mandatory: true,
      sourceName: 'Source',
      scryCount: 2,
      cards: libCards.map(c => ({ id: c.id, name: c.name })),
      scryFollowupChoice: true,
      scryFollowupKind: 'damage_each_opponent',
      scryFollowupController: p1,
      scryFollowupAmount: 3,
      scryFollowupSourceName: 'Source',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'scry');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: { keepTopOrder: ['c1', 'c2'], bottomOrder: [] },
    });

    expect((game.state as any).life[p2]).toBe(37);
  });

  it('draws after scry when no condition is required', async () => {
    const { p1, libCards } = setupGame();

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.SCRY,
      playerId: p1 as any,
      description: 'Source: Scry 2',
      mandatory: true,
      sourceName: 'Source',
      scryCount: 2,
      cards: libCards.map(c => ({ id: c.id, name: c.name })),
      scryFollowupChoice: true,
      scryFollowupKind: 'draw_cards',
      scryFollowupController: p1,
      scryFollowupAmount: 1,
      scryFollowupSourceName: 'Source',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'scry');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: { keepTopOrder: ['c1', 'c2'], bottomOrder: [] },
    });

    const drawChat = emitted.find(entry =>
      entry.event === 'chat' && String(entry.payload?.message || '').includes('draws 1 card')
    );
    expect(drawChat).toBeDefined();
  });

  it('skips conditional draw when controller does not control an artifact', async () => {
    const { game, p1, libCards } = setupGame();

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.SCRY,
      playerId: p1 as any,
      description: 'Source: Scry 2',
      mandatory: true,
      sourceName: 'Source',
      scryCount: 2,
      cards: libCards.map(c => ({ id: c.id, name: c.name })),
      scryFollowupChoice: true,
      scryFollowupKind: 'draw_cards',
      scryFollowupController: p1,
      scryFollowupAmount: 1,
      scryFollowupSourceName: 'Source',
      scryFollowupCondition: 'controller_controls_artifact',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'scry');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: { keepTopOrder: ['c1', 'c2'], bottomOrder: [] },
    });

    expect((game.state as any).zones[p1].handCount).toBe(0);
  });
});