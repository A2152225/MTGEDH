import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

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

describe('Oracle IR station charge counters (integration)', () => {
  const gameId = 'test_oracle_ir_station_charge_counters';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('adds charge counters equal to tapped creature power on a Planet via IR', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'planet_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 3 },
        card: {
          id: 'planet_card_1',
          name: 'Adagia, Windswept Bastion',
          type_line: 'Land — Planet',
          oracle_text:
            'Station (Tap another creature you control: Put charge counters equal to its power on this Planet. Station only as a sorcery.)\n12+ | {3}{W}, {T}: Create a 2/2 white Knight creature token.',
        },
      },
      {
        id: 'creature_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'creature_card_1',
          name: 'Test Knight',
          type_line: 'Creature — Knight',
          oracle_text: '',
          power: '5',
          toughness: '5',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'planet_1',
      abilityId: 'planet_card_1-station-0',
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe('station_creature_selection');
    expect(String(step.stationEffectText || '')).toMatch(/this Planet/i);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(step.id),
      selections: ['creature_1'],
    });

    const planet = (game.state as any).battlefield.find((perm: any) => perm.id === 'planet_1');
    const creature = (game.state as any).battlefield.find((perm: any) => perm.id === 'creature_1');
    expect(Boolean(creature?.tapped)).toBe(true);
    expect(Number(planet?.counters?.charge || 0)).toBe(8);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('marks a Spacecraft stationed when threshold is met after IR counter placement', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'ship_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 8 },
        card: {
          id: 'ship_card_1',
          name: 'Test Spacecraft',
          type_line: 'Artifact — Spacecraft',
          oracle_text:
            'Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery.)\n10+ | Creatures you control have flying.',
        },
      },
      {
        id: 'creature_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'creature_card_1',
          name: 'Test Bear',
          type_line: 'Creature — Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'ship_1',
      abilityId: 'ship_card_1-station-0',
    });

    const step = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(step.id),
      selections: ['creature_1'],
    });

    const ship = (game.state as any).battlefield.find((perm: any) => perm.id === 'ship_1');
    expect(Number(ship?.counters?.charge || 0)).toBe(10);
    expect(Boolean(ship?.stationed)).toBe(true);
    expect((ship?.grantedTypes || []).includes('Creature')).toBe(true);
  });
});
