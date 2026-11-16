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

function setupDraw(game: any, p1: string, p2: string, library: any[], opts: { tomorrow?: boolean; archmageQuest?: number }) {
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
  const battlefield: any[] = [];
  if (opts.tomorrow) {
    battlefield.push({
      id: 'tm_1',
      controller: p1,
      owner: p1,
      card: { name: "Tomorrow, Azami's Familiar", type_line: 'Legendary Creature — Spirit', oracle_text: TOMORROW_ORACLE },
    });
  }
  if (opts.archmageQuest != null) {
    battlefield.push({
      id: 'aa_1',
      controller: p1,
      owner: p1,
      counters: { quest: opts.archmageQuest },
      card: { name: 'Archmage Ascension', type_line: 'Enchantment', oracle_text: ARCHMAGE_ORACLE },
    });
  }
  (game.state as any).battlefield = battlefield;
}

describe('CR 616.1 replacement order on draws (Tomorrow vs Archmage)', () => {
  const tracked = new Set<string>();
  const createGameId = () => `test_repl_order_draw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((r) => setTimeout(r, 0));
  });
  beforeEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });
  afterEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });

  it('auto-picks when only Tomorrow applies (no order prompt)', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    setupDraw(game, p1, p2, [card('c1', 'Island'), card('c2', 'Mountain'), card('c3', 'Swamp')], { tomorrow: true });
    drawCards(game as any, p1 as any, 1);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.replacementOrderChoice === true)).toBe(false);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.tomorrowDrawReplacement === true);
    expect(step).toBeDefined();
  });

  it('queues an order prompt when Tomorrow and Archmage both apply', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    setupDraw(game, p1, p2, [card('c1', 'Island'), card('c2', 'Mountain'), card('c3', 'Swamp')], { tomorrow: true, archmageQuest: 6 });
    drawCards(game as any, p1 as any, 1);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.replacementOrderChoice === true) as any;
    expect(step).toBeDefined();
    expect(step.type).toBe('option_choice');
    const effectIds = (step.replacementOrderCandidates || []).map((c: any) => c.effectId).sort();
    expect(effectIds).toEqual(['controller-draw-look-top-put-one-in-hand', 'optional-search-instead-of-draw'].sort());
    expect(step.options).toHaveLength(2);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.tomorrowDrawReplacement === true)).toBe(false);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.archmageAscensionSearchInstead === true)).toBe(false);
  });

  it('applies Tomorrow first when chosen, so the look prompt is next and Archmage does not fire for this draw', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    setupDraw(game, p1, p2, [card('c1', 'Island'), card('c2', 'Mountain'), card('c3', 'Swamp'), card('c4', 'Forest')], { tomorrow: true, archmageQuest: 6 });

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId); (socket.data as any).gameId = gameId;
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);

    drawCards(game as any, p1 as any, 1);
    const order = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.replacementOrderChoice === true) as any;
    const tomorrowId = (order.replacementOrderCandidates || []).find((c: any) => c.effectId === 'controller-draw-look-top-put-one-in-hand').id;
    await handlers['submitResolutionResponse']({ gameId, stepId: order.id, selections: [tomorrowId], cancelled: false });

    const tomorrow = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.tomorrowDrawReplacement === true) as any;
    expect(tomorrow).toBeDefined();
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.archmageAscensionSearchInstead === true)).toBe(false);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: tomorrow.id,
      selections: { toHand: ['c2'], newOrder: ['c3', 'c1'], shouldShuffle: false },
      cancelled: false,
    });
    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['c2']);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.archmageAscensionSearchInstead === true)).toBe(false);
  });

  it('applies Archmage first when chosen; declining the search still lets Tomorrow replace the draw', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    setupDraw(game, p1, p2, [card('c1', 'Island'), card('c2', 'Mountain'), card('c3', 'Swamp')], { tomorrow: true, archmageQuest: 6 });

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId); (socket.data as any).gameId = gameId;
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);

    drawCards(game as any, p1 as any, 1);
    const order = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.replacementOrderChoice === true) as any;
    const archmageId = (order.replacementOrderCandidates || []).find((c: any) => c.effectId === 'optional-search-instead-of-draw').id;
    await handlers['submitResolutionResponse']({ gameId, stepId: order.id, selections: [archmageId], cancelled: false });

    const search = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.archmageAscensionSearchInstead === true) as any;
    expect(search).toBeDefined();
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.tomorrowDrawReplacement === true)).toBe(false);

    await handlers['submitResolutionResponse']({ gameId, stepId: search.id, selections: [], cancelled: true });
    const tomorrow = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.tomorrowDrawReplacement === true) as any;
    expect(tomorrow).toBeDefined();
    expect(((game.state as any).zones[p1].hand || [])).toHaveLength(0);
  });
});
