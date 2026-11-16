import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { drawCards } from '../src/state/modules/zones-handlers/zonesDrawCards.js';
import '../src/state/modules/priority.js';

const ARCHMAGE_ORACLE =
  "At the beginning of each end step, if you drew two or more cards this turn, you may put a quest counter on Archmage Ascension.\nAs long as Archmage Ascension has six or more quest counters on it, if you would draw a card, you may instead search your library for a card, put that card into your hand, then shuffle.";

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createNoopIo() {
  return { to: () => ({ emit: () => undefined }), emit: () => undefined } as any;
}

function createMockIo(emitted: any[], sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: any[]) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  return { socket, handlers };
}

function card(id: string, name: string, extra: any = {}) {
  return { id, name, ...extra, card: { id, name, ...extra } };
}

function setupGame(game: any, p1: string, p2: string, library: any[], quest: number) {
  (game as any).gameId = game.id || game.gameId;
  (game.state as any).players = [{ id: p1, name: 'P1', life: 40 }, { id: p2, name: 'P2', life: 40 }];
  (game.state as any).turnPlayer = p1;
  (game.state as any).step = 'draw';
  (game.state as any).phase = 'DRAW';
  (game.state as any).zones = {
    [p1]: { hand: [], library: [...library], graveyard: [], exile: [], handCount: 0, libraryCount: library.length },
    [p2]: { hand: [], library: [], graveyard: [], exile: [], handCount: 0, libraryCount: 0 },
  };
  (game as any).libraries = (game as any).libraries || new Map();
  (game as any).libraries.set(p1, [...library]);
  (game as any).libraries.set(p2, []);
  (game.state as any).battlefield = [
    {
      id: 'aa_1',
      controller: p1,
      owner: p1,
      counters: { quest },
      card: { name: 'Archmage Ascension', type_line: 'Enchantment', oracle_text: ARCHMAGE_ORACLE },
    },
  ];
}

describe('Archmage Ascension search-instead-of-draw (resolution queue integration)', () => {
  const tracked = new Set<string>();
  const createGameId = () => `test_archmage_search_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((r) => setTimeout(r, 0));
  });

  beforeEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });
  afterEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });

  it('queues an optional library search at 6+ quest counters and puts the chosen card into hand, then shuffles', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    const lib = [card('c1', 'Island'), card('c2', 'Mountain'), card('c3', 'Swamp')];
    setupGame(game, p1, p2, lib, 6);

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId); (socket.data as any).gameId = gameId;
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);

    drawCards(game as any, p1 as any, 1);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.archmageAscensionSearchInstead === true) as any;
    expect(step).toBeDefined();
    expect(step.type).toBe('library_search');
    expect(step.mandatory).toBe(false);
    expect((game.state as any).zones[p1].hand).toHaveLength(0);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: ['c2'],
      cancelled: false,
    });

    const handIds = ((game.state as any).zones[p1].hand || []).map((c: any) => c.id);
    const libIds = ((game.state as any).zones[p1].library || []).map((c: any) => c.id);
    expect(handIds).toEqual(['c2']);
    expect(libIds.sort()).toEqual(['c1', 'c3']);
    expect(libIds).not.toContain('c2');
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.archmageAscensionSearchInstead === true)).toBe(false);
  });

  it('draws normally when the player declines the search', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    setupGame(game, p1, p2, [card('top', 'Sol Ring'), card('next', 'Island')], 6);

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId); (socket.data as any).gameId = gameId;
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);

    drawCards(game as any, p1 as any, 1);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.archmageAscensionSearchInstead === true) as any;
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: [],
      cancelled: true,
    });

    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['top']);
    expect(((game.state as any).zones[p1].library || []).map((c: any) => c.id)).toEqual(['next']);
  });

  it('does not prompt with fewer than six quest counters and draws normally', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    setupGame(game, p1, p2, [card('top', 'Forest')], 5);

    drawCards(game as any, p1 as any, 1);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.archmageAscensionSearchInstead === true)).toBe(false);
    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['top']);
  });

  it('resumes leftover draws after the search choice', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    setupGame(game, p1, p2, [card('a', 'Alpha'), card('b', 'Beta'), card('c', 'Gamma')], 6);

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId); (socket.data as any).gameId = gameId;
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);

    drawCards(game as any, p1 as any, 2);
    const first = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.archmageAscensionSearchInstead === true) as any;
    expect(first).toBeDefined();
    expect(first.remainingDrawCountAfterChoice).toBe(1);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: first.id,
      selections: ['c'],
      cancelled: false,
    });

    const second = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.archmageAscensionSearchInstead === true) as any;
    expect(second).toBeDefined();
    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['c']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: second.id,
      selections: [],
      cancelled: true,
    });

    const handIds = ((game.state as any).zones[p1].hand || []).map((c: any) => c.id);
    expect(handIds[0]).toBe('c');
    expect(handIds).toHaveLength(2);
    expect(handIds[1]).not.toBe('c');
    expect(((game.state as any).zones[p1].library || [])).toHaveLength(1);
  });
});
