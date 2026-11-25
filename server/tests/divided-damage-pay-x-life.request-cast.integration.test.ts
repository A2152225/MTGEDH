import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';

type Emitted = Array<{ room?: string; event: string; payload: any }>;

function createMockIo(emitted: Emitted, sockets: any[]) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => { emitted.push({ room, event, payload }); } }),
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
    sockets: { sockets: new Map(sockets.map((socket) => [socket.id || socket.data.playerId, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Emitted, gameId: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: `${playerId}_socket`,
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  return { socket, handlers };
}

function land(id: string, name: string, color: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    card: {
      name,
      type_line: `Basic Land — ${name}`,
      oracle_text: `{T}: Add {${color}}.`,
    },
  };
}

const FIRE_COVENANT =
  'As an additional cost to cast this spell, pay X life.\nFire Covenant deals X damage divided as you choose among any number of target creatures.';

const gameId = 'test_fire_covenant_pay_x_life_request_cast';
const playerId = 'p1';
const opponentId = 'p2';

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Fire Covenant request-cast pay-X-life then divided damage', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame();
  });

  afterEach(async () => {
    await resetGame();
  });

  it('announces X life before targets, then prompts for an uneven split before mana payment', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const state = game.state as any;
    state.players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    state.startingLife = 40;
    state.life = { [playerId]: 40, [opponentId]: 40 };
    state.phase = 'precombatMain';
    state.step = 'MAIN1';
    state.turnPlayer = playerId;
    state.activePlayer = playerId;
    state.priority = playerId;
    state.stack = [];
    state.manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    state.battlefield = [
      land('swamp_1', 'Swamp', 'B', playerId),
      land('mountain_1', 'Mountain', 'R', playerId),
      land('mountain_2', 'Mountain', 'R', playerId),
      {
        id: 'giant',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        damageMarked: 0,
        card: { name: 'Hill Giant', type_line: 'Creature — Giant', power: '3', toughness: '5', oracle_text: '' },
      },
      {
        id: 'wurm',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        damageMarked: 0,
        card: { name: 'Craw Wurm', type_line: 'Creature — Wurm', power: '6', toughness: '4', oracle_text: '' },
      },
    ];
    state.zones = {
      [playerId]: {
        hand: [{
          id: 'covenant_1',
          name: 'Fire Covenant',
          mana_cost: '{1}{B}{R}',
          manaCost: '{1}{B}{R}',
          type_line: 'Instant',
          oracle_text: FIRE_COVENANT,
          colors: ['B', 'R'],
          image_uris: { small: 'https://example.com/fire-covenant.jpg' },
        }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };

    const emitted: Emitted = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'covenant_1' });

    let queue = ResolutionQueueManager.getQueue(gameId);
    const lifeStep = queue.steps.find((entry: any) => entry.type === 'life_payment') as any;
    expect(lifeStep).toBeDefined();
    expect(queue.steps.some((entry: any) => entry.type === 'target_selection')).toBe(false);
    expect(queue.steps.some((entry: any) => entry.type === 'damage_division')).toBe(false);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(lifeStep.id),
      selections: 5,
    });

    expect(state.life[playerId]).toBe(35);

    queue = ResolutionQueueManager.getQueue(gameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === 'target_selection') as any;
    expect(targetStep).toBeDefined();
    expect(queue.steps.some((entry: any) => entry.type === 'damage_division')).toBe(false);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['giant', 'wurm'],
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const divisionStep = queue.steps.find((entry: any) => entry.type === 'damage_division') as any;
    expect(divisionStep).toBeDefined();
    expect(Number(divisionStep.totalAmount)).toBe(5);
    expect(queue.steps.some((entry: any) => entry.type === 'mana_payment_choice')).toBe(false);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(divisionStep.id),
      selections: { giant: 4, wurm: 1 },
    });

    const pending = Object.values(state.pendingSpellCasts || {})[0] as any;
    expect(pending?.damageDivisionByTargetId).toEqual({ giant: 4, wurm: 1 });
    expect(pending?.xValue).toBe(5);

    queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find((entry: any) => entry.type === 'mana_payment_choice' && entry.spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();

    emitted.length = 0;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: 'swamp_1', mana: 'B', count: 1 },
          { permanentId: 'mountain_1', mana: 'R', count: 1 },
          { permanentId: 'mountain_2', mana: 'R', count: 1 },
        ],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const castError = emitted.find((event) => event.event === 'error');
    expect(castError).toBeUndefined();

    const stackItem = (state.stack || []).find((entry: any) => entry.card?.name === 'Fire Covenant' || entry.sourceName === 'Fire Covenant');
    expect(stackItem).toBeDefined();
    expect(stackItem.xValue).toBe(5);
    expect(stackItem.damageDivisionByTargetId).toEqual({ giant: 4, wurm: 1 });
    expect((state.zones[playerId].hand || []).map((card: any) => card.id)).not.toContain('covenant_1');
  });
});
