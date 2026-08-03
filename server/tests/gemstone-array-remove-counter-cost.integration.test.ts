import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists, deleteGame, getEvents } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

const GEMSTONE_ORACLE =
  '{2}: Put a charge counter on this artifact.\nRemove a charge counter from this artifact: Add one mana of any color.';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {},
    }),
    emit: (_event: string, _payload: any) => {},
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
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
  await deleteGame(gameId);
}

describe('Gemstone Array remove-counter mana cost (integration)', () => {
  const gameId = 'test_gemstone_array_remove_counter_cost';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('removes a charge counter when resolving any-color mana from Gemstone Array', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'gemstone_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 3 },
        card: {
          id: 'gemstone_card_1',
          name: 'Gemstone Array',
          type_line: 'Artifact',
          oracle_text: GEMSTONE_ORACLE,
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    // ability-1 = "Remove a charge counter ... Add one mana of any color."
    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'gemstone_1',
      abilityId: 'gemstone_1-ability-1',
    });

    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'gemstone_1');
    // Counter removal is deferred until color choice completes.
    expect(Number(permanent?.counters?.charge || 0)).toBe(3);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String(queue.steps[0]?.type || '')).toBe('mana_color_selection');
    expect(Array.isArray((queue.steps[0] as any)?.pendingCounterRemovals)).toBe(true);
    expect((queue.steps[0] as any).pendingCounterRemovals).toEqual([{ counterType: 'charge', count: 1 }]);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(queue.steps[0]?.id || ''),
      selections: 'blue',
    });

    expect(Number(permanent?.counters?.charge || 0)).toBe(2);
    expect((game.state as any).manaPool?.[playerId]).toEqual({
      white: 0,
      blue: 1,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    });

    const events = getEvents(gameId);
    const activationEvents = events.filter((event) => String(event?.type) === 'activateBattlefieldAbility');
    expect(activationEvents.length).toBeGreaterThan(0);
    const lastActivation = activationEvents[activationEvents.length - 1] as any;
    expect(lastActivation?.payload?.removedCountersForCost).toEqual([
      { permanentId: 'gemstone_1', counterType: 'charge', count: 1 },
    ]);
  });

  it('cannot charge Gemstone Array when only unpaid remove-potential mana is available', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'gemstone_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 5 },
        card: {
          id: 'gemstone_card_2',
          name: 'Gemstone Array',
          type_line: 'Artifact',
          oracle_text: GEMSTONE_ORACLE,
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    // ability-0 = "{2}: Put a charge counter on this artifact."
    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'gemstone_2',
      abilityId: 'gemstone_2-ability-0',
    });

    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'gemstone_2');
    expect(Number(permanent?.counters?.charge || 0)).toBe(5);
    expect((game.state as any).manaPool?.[playerId]?.colorless || 0).toBe(0);

    const insufficient = emitted.filter(
      (entry) => entry.event === 'error' && String(entry.payload?.code || '') === 'INSUFFICIENT_MANA',
    );
    expect(insufficient.length).toBeGreaterThan(0);
  });
});
