import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { hasUsedPowerUpAbility } from '../src/state/modules/marvelMechanicsHelpers.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const THANOS_POWER_UP_ORACLE =
  'Power-up — {2}{R}: Draw a card. (Activate each power-up ability only once. Reduce the cost by his mana cost if he entered this turn.)';

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

function seedPowerUpGame(game: any, playerId: string, options?: { enteredThisTurn?: boolean }) {
  const enteredThisTurn = options?.enteredThisTurn !== false;
  Object.assign(game.state as any, {
    players: [{ id: playerId, name: 'P1', spectator: false, life: 40, isAI: false }],
    startingLife: 40,
    life: { [playerId]: 40 },
    phase: 'precombat_main',
    step: 'MAIN1',
    turnPlayer: playerId,
    activePlayer: playerId,
    turnNumber: 3,
    priority: playerId,
    stack: [],
    manaPool: {
      [playerId]: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
    battlefield: [
      {
        id: 'thanos_perm',
        controller: playerId,
        owner: playerId,
        tapped: false,
        enteredThisTurn,
        counters: {},
        card: {
          id: 'thanos_card',
          name: 'Thanos, the Mad Titan',
          type_line: 'Legendary Creature — Eternal Villain',
          mana_cost: '{2}{R}',
          oracle_text: THANOS_POWER_UP_ORACLE,
        },
      },
    ],
    zones: {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [{ id: 'drawn_island', name: 'Island', type_line: 'Basic Land — Island' }],
        libraryCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    },
  });
  game.libraries = game.libraries || new Map();
  game.libraries.set(playerId, [{ id: 'drawn_island', name: 'Island', type_line: 'Basic Land — Island', zone: 'library' }]);
}

describe('power-up activated ability socket integration (Layer 3)', () => {
  const gameId = 'test_power_up_activated_socket';
  const playerId = 'p1';

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

  it('activates a discounted power-up through the stack and draws a card via IR', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);
    seedPowerUpGame(game, playerId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'thanos_perm',
      abilityId: 'thanos_card-ability-0',
    });

    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
    expect(((game.state as any).stack || []).length).toBe(1);
    const stackItem = (game.state as any).stack[0] as any;
    expect(String(stackItem?.description || '')).toMatch(/draw a card/i);
    expect(String(stackItem?.activatedAbilityText || '')).toMatch(/^Power-up/i);

    game.resolveTopOfStack();

    const thanos = ((game.state as any).battlefield || []).find((perm: any) => perm.id === 'thanos_perm');
    expect(hasUsedPowerUpAbility(thanos, 0)).toBe(true);
    const hand = (game.state as any).zones?.[playerId]?.hand || [];
    expect(hand.map((card: any) => card.id)).toEqual(['drawn_island']);
    expect(((game.state as any).stack || []).length).toBe(0);
  }, 15000);

  it('rejects a second activation of the same power-up ability', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);
    seedPowerUpGame(game, playerId);

    const thanos = ((game.state as any).battlefield || []).find((perm: any) => perm.id === 'thanos_perm');
    (thanos as any).powerUpAbilitiesUsed = { 0: true };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);

    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'thanos_perm',
      abilityId: 'thanos_card-ability-0',
    });

    const errorPayload = emitted.find((entry) => entry.event === 'error')?.payload;
    expect(errorPayload?.code).toBe('POWER_UP_ALREADY_USED');
    expect(((game.state as any).stack || []).length).toBe(0);
  });
});
