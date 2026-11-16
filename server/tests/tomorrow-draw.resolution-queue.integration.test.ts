import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { drawCards } from '../src/state/modules/zones-handlers/zonesDrawCards.js';
import '../src/state/modules/priority.js';

const TOMORROW_ORACLE =
  "If you would draw a card, look at the top three cards of your library instead. Put one of those cards into your hand and the rest on the bottom of your library in any order.";

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

function setupGame(game: any, p1: string, p2: string, library: any[]) {
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
      id: 'tm_1',
      controller: p1,
      owner: p1,
      card: { name: "Tomorrow, Azami's Familiar", type_line: 'Legendary Creature — Spirit', oracle_text: TOMORROW_ORACLE },
    },
  ];
}

describe('Tomorrow look-put-draw (resolution queue integration)', () => {
  const tracked = new Set<string>();
  const createGameId = () => `test_tomorrow_draw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((r) => setTimeout(r, 0));
  });

  beforeEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });
  afterEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });

  it('queues a look-and-order prompt and puts the chosen card in hand, rest on the bottom', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    const lib = [card('c1', 'Island'), card('c2', 'Mountain'), card('c3', 'Swamp'), card('c4', 'Forest')];
    setupGame(game, p1, p2, lib);

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId); (socket.data as any).gameId = gameId;
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io, socket);

    drawCards(game as any, p1 as any, 1);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.tomorrowDrawReplacement === true) as any;
    expect(step).toBeDefined();
    expect(step.type).toBe('ponder_effect');
    expect(step.variant).toBe('anticipate');
    expect(step.cards.map((c: any) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect((game.state as any).zones[p1].hand).toHaveLength(0);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: { toHand: ['c2'], newOrder: ['c3', 'c1'], shouldShuffle: false },
      cancelled: false,
    });

    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.tomorrowDrawReplacement === true)).toBe(false);
    const handIds = ((game.state as any).zones[p1].hand || []).map((c: any) => c.id);
    const libIds = ((game.state as any).zones[p1].library || []).map((c: any) => c.id);
    expect(handIds).toEqual(['c2']);
    expect(libIds).toEqual(['c4', 'c3', 'c1']);
  });

  it('auto-applies when only one card can be looked at', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    setupGame(game, p1, p2, [card('only', 'Solo Island')]);

    drawCards(game as any, p1 as any, 1);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.tomorrowDrawReplacement === true)).toBe(false);
    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['only']);
    expect((game.state as any).zones[p1].library || []).toHaveLength(0);
  });

  it('looks at fewer than three cards when the library is short, then resumes leftover draws', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    setupGame(game, p1, p2, [card('a', 'Alpha'), card('b', 'Beta'), card('c', 'Gamma')]);

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId); (socket.data as any).gameId = gameId;
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);

    drawCards(game as any, p1 as any, 2);
    const first = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.tomorrowDrawReplacement === true) as any;
    expect(first).toBeDefined();
    expect(first.cards.map((c: any) => c.id)).toEqual(['a', 'b', 'c']);
    expect(first.remainingDrawCountAfterChoice).toBe(1);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: first.id,
      selections: { toHand: ['c'], newOrder: ['a', 'b'], shouldShuffle: false },
      cancelled: false,
    });

    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['c']);
    // Remaining draw looks at the two bottomed cards; only one choice is automatic? two cards => prompt.
    const second = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.tomorrowDrawReplacement === true) as any;
    expect(second).toBeDefined();
    expect(second.cards.map((c: any) => c.id)).toEqual(['a', 'b']);
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: second.id,
      selections: { toHand: ['b'], newOrder: ['a'], shouldShuffle: false },
      cancelled: false,
    });
    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['c', 'b']);
    expect(((game.state as any).zones[p1].library || []).map((c: any) => c.id)).toEqual(['a']);
  });

  it('does not lose on an empty library look (zero cards, no prompt)', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    setupGame(game, p1, p2, []);
    drawCards(game as any, p1 as any, 1);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.tomorrowDrawReplacement === true)).toBe(false);
    expect((game.state as any).zones[p1].hand || []).toHaveLength(0);
    const player = (game.state as any).players.find((p: any) => p.id === p1);
    expect(player?.hasLost).toBeFalsy();
  });
});
