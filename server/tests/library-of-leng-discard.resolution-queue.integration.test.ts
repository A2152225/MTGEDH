import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const LENG_ORACLE = "If an effect causes you to discard a card, discard it, but you may put it on top of your library instead of into your graveyard.";

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createMockIo(emitted: any[], sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: any[], gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

function shock() {
  return { id: 'shock_1', name: 'Shock', type_line: 'Instant', mana_cost: '{R}', oracle_text: 'Shock deals 2 damage to any target.' };
}

function setupLeng(game: any, p1: string, withLeng: boolean, extraHand: any[] = []) {
  (game as any).gameId = game.id || game.gameId;
  (game.state as any).players = [{ id: p1, name: 'P1', life: 40 }];
  const card = shock();
  (game.state as any).zones = {
    [p1]: { hand: [card, ...extraHand], library: [{ id: 'island_1', name: 'Island' }], graveyard: [], exile: [], handCount: 1 + extraHand.length, libraryCount: 1, graveyardCount: 0 },
  };
  (game as any).libraries = (game as any).libraries || new Map();
  (game as any).libraries.set(p1, [{ id: 'island_1', name: 'Island' }]);
  (game.state as any).battlefield = withLeng ? [{
    id: 'leng_1',
    controller: p1,
    owner: p1,
    card: { name: 'Library of Leng', type_line: 'Artifact', oracle_text: LENG_ORACLE },
  }] : [];
  return card;
}

async function submitDiscard(game: any, gameId: string, p1: string, cardId: string, stepExtras: any = {}) {
  const step = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.DISCARD_SELECTION,
    playerId: p1,
    description: 'Discard a card.',
    mandatory: true,
    discardCount: 1,
    hand: (game.state as any).zones[p1].hand,
    ...stepExtras,
  } as any);
  const emitted: any[] = [];
  const { socket, handlers } = createMockSocket(p1, emitted, gameId);
  registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
  await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: [cardId], cancelled: false });
  return { handlers, emitted };
}

describe('Library of Leng discard-to-library-top choice', () => {
  const tracked = new Set<string>();
  const createGameId = () => `test_leng_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });
  afterEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });

  it('does not prompt when the player does not have Library of Leng', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    const p1 = 'p1';
    const card = setupLeng(game, p1, false);
    await submitDiscard(game, gameId, p1, card.id);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.libraryOfLengDiscardChoice === true)).toBe(false);
    expect(((game.state as any).zones[p1].graveyard || []).map((c: any) => c.id)).toEqual(['shock_1']);
  });

  it('does not prompt for a cleanup or as-cost discard', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    const p1 = 'p1';
    const card = setupLeng(game, p1, true);
    await submitDiscard(game, gameId, p1, card.id, { reason: 'cleanup' });
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.libraryOfLengDiscardChoice === true)).toBe(false);
    expect(((game.state as any).zones[p1].graveyard || []).map((c: any) => c.id)).toEqual(['shock_1']);
  });

  it('queues an optional choice for an effect discard and can put the card on top of the library', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    const p1 = 'p1';
    const card = setupLeng(game, p1, true);
    const { handlers } = await submitDiscard(game, gameId, p1, card.id);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.libraryOfLengDiscardChoice === true) as any;
    expect(step).toBeDefined();
    expect(step.mandatory).toBe(false);
    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual([]);
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['library_top'], cancelled: false });
    expect(((game.state as any).zones[p1].graveyard || []).map((c: any) => c.id)).toEqual([]);
    const lib = (game as any).libraries.get(p1) || (game.state as any).zones[p1].library;
    expect(lib[0]?.id).toBe('shock_1');
    expect(lib[1]?.id).toBe('island_1');
  });

  it('leaves the discarded card in the graveyard when the choice is declined', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    const p1 = 'p1';
    const card = setupLeng(game, p1, true);
    const { handlers } = await submitDiscard(game, gameId, p1, card.id);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.libraryOfLengDiscardChoice === true) as any;
    expect(step).toBeDefined();
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['graveyard'], cancelled: false });
    expect(((game.state as any).zones[p1].graveyard || []).map((c: any) => c.id)).toEqual(['shock_1']);
    const lib = (game as any).libraries.get(p1) || (game.state as any).zones[p1].library;
    expect(lib[0]?.id).toBe('island_1');
  });
});
