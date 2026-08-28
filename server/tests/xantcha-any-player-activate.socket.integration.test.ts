import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const XANTCHA_ORACLE =
  "Xantcha enters under the control of an opponent of your choice.\n" +
  "Xantcha attacks each combat if able and can't attack its owner or planeswalkers its owner controls.\n" +
  "{3}: Xantcha's controller loses 2 life and you draw a card. Any player may activate this ability.";

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

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // test-only cleanup
  }
}

function seedXantchaGame(game: any, ownerId: string, controllerId: string) {
  Object.assign(game.state as any, {
    players: [
      { id: ownerId, name: 'Owner', spectator: false, life: 40, isAI: false },
      { id: controllerId, name: 'Controller', spectator: false, life: 40, isAI: false },
    ],
    startingLife: 40,
    life: { [ownerId]: 40, [controllerId]: 40 },
    phase: 'precombat_main',
    step: 'MAIN1',
    turnPlayer: ownerId,
    activePlayer: ownerId,
    turnNumber: 3,
    priority: ownerId,
    stack: [],
    manaPool: {
      [ownerId]: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
    },
    battlefield: [
      {
        id: 'xantcha-1',
        controller: controllerId,
        owner: ownerId,
        tapped: false,
        card: {
          id: 'xantcha_card',
          name: 'Xantcha, Sleeper Agent',
          type_line: 'Legendary Creature — Phyrexian Minion',
          oracle_text: XANTCHA_ORACLE,
          power: '5',
          toughness: '5',
        },
      },
    ],
    zones: {
      [ownerId]: {
        hand: [],
        handCount: 0,
        library: [{ id: 'lib_1', name: 'Island', type_line: 'Basic Land — Island' }],
        libraryCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [controllerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    },
  });
}

describe('Xantcha any-player {3} activation when an opponent controls it', () => {
  const gameId = 'test_xantcha_any_player_activate';
  const ownerId = 'p1';
  const controllerId = 'p2';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('lets the non-controller pay {3} and put the ability on the stack', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, ownerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);
    seedXantchaGame(game, ownerId, controllerId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(ownerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'xantcha-1',
      abilityId: 'xantcha_card-ability-0',
    });

    const errors = emitted.filter((entry) => entry.event === 'error');
    expect(errors).toEqual([]);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0].controller).toBe(ownerId);
    expect(String(stack[0].activatedAbilityText || stack[0].description || '')).toMatch(/controller loses 2 life/i);

    const pool = (game.state as any).manaPool?.[ownerId] || {};
    expect(Number(pool.colorless || 0)).toBe(0);
  }, 15000);
});
