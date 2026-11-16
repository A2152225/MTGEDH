import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

const POWDER_ORACLE =
  'Any time you could mulligan and this card is in your hand, you may exile all the cards from your hand, then draw that many cards.';

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

function card(id: string, name: string, oracle = '', type_line = 'Sorcery') {
  return { id, name, oracle_text: oracle, type_line, card: { id, name, oracle_text: oracle, type_line } };
}

function setupPregame(game: any, p1: string, p2: string, hand: any[], library: any[]) {
  (game as any).gameId = game.id || game.gameId;
  (game.state as any).players = [{ id: p1, name: 'P1', life: 40 }, { id: p2, name: 'P2', life: 40 }];
  (game.state as any).phase = 'PRE_GAME';
  (game.state as any).mulliganState = { [p1]: { hasKeptHand: false, mulligansTaken: 0, pendingBottomCount: 0 } };
  (game.state as any).zones = {
    [p1]: { hand: [...hand], library: [...library], graveyard: [], exile: [], handCount: hand.length, libraryCount: library.length },
    [p2]: { hand: [], library: [], graveyard: [], exile: [], handCount: 0, libraryCount: 0 },
  };
  (game as any).libraries = (game as any).libraries || new Map();
  (game as any).libraries.set(p1, [...library]);
  (game as any).libraries.set(p2, []);
}

describe('Serum Powder mulligan action (integration)', () => {
  const tracked = new Set<string>();
  const createGameId = () => `test_serum_powder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((r) => setTimeout(r, 0));
  });

  beforeEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });
  afterEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });

  it('exiles the hand and draws that many without consuming a mulligan, and can be repeated', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    const firstHand = [
      card('sp1', 'Serum Powder', POWDER_ORACLE, 'Artifact'),
      card('h2', 'Island'), card('h3', 'Island'), card('h4', 'Island'),
      card('h5', 'Island'), card('h6', 'Island'), card('h7', 'Island'),
    ];
    const library = [
      card('sp2', 'Serum Powder', POWDER_ORACLE, 'Artifact'),
      card('n2', 'Mountain'), card('n3', 'Mountain'), card('n4', 'Mountain'),
      card('n5', 'Mountain'), card('n6', 'Mountain'), card('n7', 'Mountain'),
      card('x1', 'Forest'), card('x2', 'Forest'), card('x3', 'Forest'),
      card('x4', 'Forest'), card('x5', 'Forest'), card('x6', 'Forest'), card('x7', 'Forest'),
    ];
    setupPregame(game, p1, p2, firstHand, library);

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId); (socket.data as any).gameId = gameId;
    registerGameActions(createMockIo(emitted, [socket]), socket);

    await handlers['serumPowderHandRestart']({ gameId, sourceId: 'sp1' });

    const zones = (game.state as any).zones[p1];
    expect(zones.hand.map((c: any) => c.id)).toEqual(['sp2', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7']);
    expect(zones.exile.map((c: any) => c.id)).toEqual(['sp1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7']);
    expect((game.state as any).mulliganState[p1].mulligansTaken).toBe(0);
    expect((game.state as any).mulliganState[p1].hasKeptHand).toBeFalsy();

    await handlers['serumPowderHandRestart']({ gameId });
    const zones2 = (game.state as any).zones[p1];
    expect(zones2.hand.map((c: any) => c.id)).toEqual(['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7']);
    expect(zones2.exile).toHaveLength(14);
    expect((game.state as any).mulliganState[p1].mulligansTaken).toBe(0);
  });

  it('rejects the action after the hand is kept, with no Powder, or at the mulligan cap', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    const powder = card('sp1', 'Serum Powder', POWDER_ORACLE, 'Artifact');
    const island = card('h2', 'Island');
    setupPregame(game, p1, p2, [island], [card('n1', 'Mountain')]);

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId); (socket.data as any).gameId = gameId;
    registerGameActions(createMockIo(emitted, [socket]), socket);

    await handlers['serumPowderHandRestart']({ gameId });
    expect(emitted.some((e) => e.event === 'error' && e.payload?.code === 'SERUM_POWDER_NOT_LEGAL')).toBe(true);
    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['h2']);

    emitted.length = 0;
    (game.state as any).zones[p1].hand = [powder];
    (game.state as any).mulliganState[p1].hasKeptHand = true;
    await handlers['serumPowderHandRestart']({ gameId });
    expect(emitted.some((e) => e.event === 'error' && e.payload?.code === 'SERUM_POWDER_NOT_LEGAL')).toBe(true);
    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['sp1']);

    emitted.length = 0;
    (game.state as any).mulliganState[p1].hasKeptHand = false;
    (game.state as any).mulliganState[p1].mulligansTaken = 6;
    await handlers['serumPowderHandRestart']({ gameId });
    expect(emitted.some((e) => e.event === 'error' && e.payload?.code === 'SERUM_POWDER_NOT_LEGAL')).toBe(true);
    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['sp1']);
  });
});
