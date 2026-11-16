import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { parseCyclingPayLifeAmount } from '../src/socket/interaction-handlers/cyclingPayLifeCost.js';
import { getCyclingDefinitionForActivation } from '../src/socket/interaction-handlers/interactionCyclingActivationDefinitions.js';
import { cardHasPrintedCycling } from '../src/state/modules/handCyclingGrants.js';

const STREET_WRAITH = 'Cycling—Pay 2 life. (Pay 2 life, Discard this card: Draw a card.)';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (event: string, fn: Function) => { handlers[event] = fn; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}


describe('Street Wraith cycling pay-life confirm', () => {
  const gameId = 'test_street_wraith_cycling_pay_life';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  beforeEach(async () => { await resetGame(gameId); });
  afterEach(async () => { await resetGame(gameId); });

  it('parses Cycling—Pay 2 life as a printed pay-life cycling cost', () => {
    const card = { name: 'Street Wraith', oracle_text: STREET_WRAITH, keywords: ['Cycling'] };
    expect(cardHasPrintedCycling(card)).toBe(true);
    const definition = getCyclingDefinitionForActivation(STREET_WRAITH, 'cycling', 'wraith_1');
    expect(definition?.kind).toBe('cycling');
    expect(parseCyclingPayLifeAmount(definition?.cost)).toBe(2);
  });

  it('queues the pay-life confirm and cycles the card after paying 2 life', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [];
    (game.state as any).zones = {
      [p1]: {
        hand: [{
          id: 'wraith_1',
          name: 'Street Wraith',
          type_line: 'Creature — Zombie Wraith',
          oracle_text: STREET_WRAITH,
          keywords: ['Cycling'],
        }],
        handCount: 1,
        library: [{ id: 'lib_1', name: 'Plains' }, { id: 'lib_2', name: 'Island' }],
        libraryCount: 2,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateCycling']({ gameId, cardId: 'wraith_1', abilityId: 'cycling' });

    const error = emitted.find((entry) => entry.event === 'error');
    expect(error).toBeUndefined();
    expect(((game.state as any).zones[p1].hand || []).map((card: any) => card.id)).toEqual(['wraith_1']);
    expect(((game.state as any).stack || []).length).toBe(0);

    const payStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step?.type === 'additional_cost_payment' && String(step?.costType || '') === 'pay_life' && step?.cyclingActivation === true
    ) as any;
    expect(payStep).toBeDefined();
    expect(Number(payStep.amount)).toBe(2);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(payStep.id),
      selections: ['pay'],
      cancelled: false,
    });

    expect(Number((game.state as any).life[p1])).toBe(38);
    expect(((game.state as any).zones[p1].hand || []).length).toBe(0);
    expect(((game.state as any).zones[p1].graveyard || []).some((card: any) => card.id === 'wraith_1')).toBe(true);
    expect(((game.state as any).stack || []).length).toBe(1);
    expect(String(((game.state as any).stack || [])[0]?.abilityType || '')).toBe('cycling');
  });
});
