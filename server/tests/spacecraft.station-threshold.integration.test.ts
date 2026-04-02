import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
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

describe('Spacecraft station threshold routing (integration)', () => {
  const gameId = 'test_spacecraft_station_threshold';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('queues Station creature selection as a cancellable resolution step', async () => {
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
        id: 'station_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 4 },
        card: {
          id: 'station_card_1',
          name: 'Test Station',
          type_line: 'Artifact — Spacecraft',
          oracle_text: 'Station\n10+ | Creatures you control have flying.',
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
      permanentId: 'station_1',
      abilityId: 'station_card_1-station-0',
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe('station_creature_selection');
    expect(step.mandatory).toBe(false);

    await handlers.cancelResolutionStep({ gameId, stepId: String(step.id) });

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    expect(emitted.some(entry => entry.event === 'resolutionStepCancelled')).toBe(true);
  });

  it('activates Evendo 12+ ability as a mana ability once the threshold is met', async () => {
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
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'evendo_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 13 },
        card: {
          id: 'evendo_card_1',
          name: 'Evendo, Waking Haven',
          type_line: 'Land',
          oracle_text: 'Evendo, Waking Haven enters tapped.\n{T}: Add {G}.\nStation\n12+ | {G}, {T}: Add {G} for each creature you control.',
        },
      },
      {
        id: 'creature_a',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: { id: 'creature_a_card', name: 'Elf A', type_line: 'Creature — Elf', oracle_text: '', power: '1', toughness: '1' },
      },
      {
        id: 'creature_b',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: { id: 'creature_b_card', name: 'Elf B', type_line: 'Creature — Elf', oracle_text: '', power: '1', toughness: '1' },
      },
      {
        id: 'creature_c',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: { id: 'creature_c_card', name: 'Elf C', type_line: 'Creature — Elf', oracle_text: '', power: '1', toughness: '1' },
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
      permanentId: 'evendo_1',
      abilityId: 'evendo_card_1-ability-1',
    });

    expect(((game.state as any).stack || []).length).toBe(0);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'evendo_1')?.tapped).toBe(true);
    expect(Number((game.state as any).manaPool?.[playerId]?.green || 0)).toBeGreaterThanOrEqual(3);
    expect(emitted.some(entry => entry.event === 'error')).toBe(false);
  });

  it('rejects Evendo 12+ ability below the required charge threshold', async () => {
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
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'evendo_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 11 },
        card: {
          id: 'evendo_card_1',
          name: 'Evendo, Waking Haven',
          type_line: 'Land',
          oracle_text: 'Evendo, Waking Haven enters tapped.\n{T}: Add {G}.\nStation\n12+ | {G}, {T}: Add {G} for each creature you control.',
        },
      },
      {
        id: 'creature_a',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: { id: 'creature_a_card', name: 'Elf A', type_line: 'Creature — Elf', oracle_text: '', power: '1', toughness: '1' },
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
      permanentId: 'evendo_1',
      abilityId: 'evendo_card_1-ability-1',
    });

    const errorEvent = emitted.find(entry => entry.event === 'error');
    expect(errorEvent?.payload?.code).toBe('ACTIVATION_CONDITION_NOT_MET');
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'evendo_1')?.tapped).toBe(false);
    expect(Number((game.state as any).manaPool?.[playerId]?.green || 0)).toBe(1);
    expect(((game.state as any).stack || []).length).toBe(0);
  });
});