import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

const SCUTA_ORACLE =
  'Kicker—Pay 3 life.\nIf Phyrexian Scuta was kicked, it enters the battlefield with four +1/+1 counters on it.';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createMockIo(emitted: Array<{ event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (_room: string) => ({ emit: (event: string, payload: any) => { emitted.push({ event, payload }); } }),
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  return { socket, handlers };
}

async function setup(gameId: string) {
  await resetGame(gameId);
  createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  (game.state as any).players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { p1: 40, p2: 40 };
  (game.state as any).phase = 'precombatMain';
  (game.state as any).step = 'MAIN1';
  (game.state as any).turnPlayer = 'p1';
  (game.state as any).priority = 'p1';
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).manaPool = { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } };
  (game.state as any).zones = {
    p1: {
      hand: [{
        id: 'scuta_1',
        name: 'Phyrexian Scuta',
        mana_cost: '{0}',
        type_line: 'Creature — Zombie',
        power: '3',
        toughness: '3',
        oracle_text: SCUTA_ORACLE,
      }],
      handCount: 1,
      exile: [],
      exileCount: 0,
      graveyard: [],
      graveyardCount: 0,
    },
    p2: { hand: [], handCount: 0, exile: [], exileCount: 0, graveyard: [], graveyardCount: 0 },
  };
  return game;
}

describe('Phyrexian Scuta kicker pay-life confirm path', () => {
  const gameId = 'test_phyrexian_scuta_kicker_pay_life';

  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { await resetGame(gameId); });
  afterEach(async () => { await resetGame(gameId); });

  it('queues the pay_life confirm when kicker is chosen, then deducts life and stamps wasKicked', async () => {
    const game = await setup(gameId);
    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId, cardId: 'scuta_1', alternateCostId: 'kicker' });

    expect(emitted.find((entry) => entry.event === 'error')).toBeUndefined();
    expect((game.state as any).life?.p1).toBe(40);
    const payLifeStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === 'additional_cost_payment' && String((step as any).costType || '') === 'pay_life') as any;
    expect(payLifeStep).toBeDefined();
    expect(Number(payLifeStep.amount)).toBe(3);
    expect(String(payLifeStep.description || '')).toMatch(/kicker/i);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(payLifeStep.id),
      selections: ['pay'],
    });

    const afterErrors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload);
    expect(afterErrors).toEqual([]);
    expect((game.state as any).life?.p1).toBe(37);
    const stackItem = ((game.state as any).stack || []).find((item: any) => String(item?.card?.name || item?.name || '') === 'Phyrexian Scuta');
    expect(stackItem).toBeDefined();
    expect(Boolean(stackItem.wasKicked || stackItem.card?.wasKicked)).toBe(true);
  });

  it('casts unkicked without a pay_life prompt or life loss', async () => {
    const game = await setup(gameId);
    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    registerGameActions(createMockIo(emitted, [socket]) as any, socket as any);

    await handlers.castSpellFromHand({ gameId, cardId: 'scuta_1' });

    const payLifeStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => String((step as any).costType || '') === 'pay_life');
    expect(payLifeStep).toBeUndefined();
    expect((game.state as any).life?.p1).toBe(40);
    const stackItem = ((game.state as any).stack || [])[0];
    expect(stackItem).toBeDefined();
    expect(stackItem.wasKicked === true || stackItem.card?.wasKicked === true).toBe(false);
  });
});
