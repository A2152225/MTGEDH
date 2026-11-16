import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { drawCards } from '../src/state/modules/zones-handlers/zonesDrawCards.js';
import '../src/state/modules/priority.js';

const TOMBS_ORACLE =
  "If you would draw a card while your library has no cards in it, instead return a creature card from your graveyard to the battlefield. If you can't, you lose the game.";

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

function creature(id: string, name: string) {
  return { id, name, type_line: 'Creature — Zombie', card: { id, name, type_line: 'Creature — Zombie' } };
}

function instant(id: string, name: string) {
  return { id, name, type_line: 'Instant', card: { id, name, type_line: 'Instant' } };
}

function setupGame(game: any, p1: string, p2: string, graveyard: any[]) {
  (game as any).gameId = game.id || game.gameId;
  (game.state as any).players = [{ id: p1, name: 'P1', life: 40 }, { id: p2, name: 'P2', life: 40 }];
  (game.state as any).turnPlayer = p1;
  (game.state as any).step = 'draw';
  (game.state as any).phase = 'DRAW';
  (game.state as any).zones = {
    [p1]: { hand: [], library: [], graveyard: [...graveyard], exile: [], handCount: 0, libraryCount: 0 },
    [p2]: { hand: [], library: [], graveyard: [], exile: [], handCount: 0, libraryCount: 0 },
  };
  (game as any).libraries = (game as any).libraries || new Map();
  (game as any).libraries.set(p1, []);
  (game as any).libraries.set(p2, []);
  (game.state as any).battlefield = [
    {
      id: 'oot_1',
      controller: p1,
      owner: p1,
      card: { name: 'Out of the Tombs', type_line: 'Enchantment', oracle_text: TOMBS_ORACLE },
    },
  ];
}

describe('Out of the Tombs empty-library draw (resolution queue integration)', () => {
  const tracked = new Set<string>();
  const createGameId = () => `test_tombs_draw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((r) => setTimeout(r, 0));
  });

  beforeEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });
  afterEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });

  it('prompts to return one of multiple graveyard creatures and puts the chosen one on the battlefield', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    setupGame(game, p1, p2, [creature('g1', 'Grizzly Bears'), creature('g2', 'Savannah Lions'), instant('bolt', 'Lightning Bolt')]);

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId); (socket.data as any).gameId = gameId;
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);

    drawCards(game as any, p1 as any, 1);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.outOfTheTombsDraw === true) as any;
    expect(step).toBeDefined();
    expect(step.type).toBe('graveyard_selection');
    expect(step.validTargets.map((t: any) => t.id).sort()).toEqual(['g1', 'g2']);
    expect((game.state as any).battlefield.some((p: any) => p.id === 'g2')).toBe(false);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: ['g2'],
      cancelled: false,
    });

    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.outOfTheTombsDraw === true)).toBe(false);
    const returned = (game.state as any).battlefield.find((p: any) => p.id === 'g2');
    expect(returned).toBeTruthy();
    expect(returned.controller).toBe(p1);
    expect(((game.state as any).zones[p1].graveyard || []).map((c: any) => c.id)).toEqual(['g1', 'bolt']);
  });

  it('automatically returns the only creature in the graveyard', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    setupGame(game, p1, p2, [creature('only', 'Lone Rider'), instant('bolt', 'Lightning Bolt')]);

    drawCards(game as any, p1 as any, 1);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.outOfTheTombsDraw === true)).toBe(false);
    const returned = (game.state as any).battlefield.find((p: any) => p.id === 'only');
    expect(returned).toBeTruthy();
    expect(returned.controller).toBe(p1);
  });

  it('makes the player lose when there is no creature to return', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    setupGame(game, p1, p2, [instant('bolt', 'Lightning Bolt')]);

    drawCards(game as any, p1 as any, 1);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.outOfTheTombsDraw === true)).toBe(false);
    const player = (game.state as any).players.find((p: any) => p.id === p1);
    expect(player?.hasLost).toBe(true);
    expect(String(player?.lostReason || player?.lossReason || '')).toMatch(/Out of the Tombs/);
  });
});
