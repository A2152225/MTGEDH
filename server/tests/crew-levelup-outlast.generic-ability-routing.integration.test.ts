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

describe('Crew, level-up, and outlast generic ability routing (integration)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue('test_crew_generic_activation');
    ResolutionQueueManager.removeQueue('test_levelup_generic_activation');
    ResolutionQueueManager.removeQueue('test_outlast_generic_activation');
    games.delete('test_crew_generic_activation' as any);
    games.delete('test_levelup_generic_activation' as any);
    games.delete('test_outlast_generic_activation' as any);
  });

  it('activates crew through the parser-emitted id and resolves the crew selection', async () => {
    const gameId = 'test_crew_generic_activation';
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'vehicle_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'vehicle_card_1',
          name: 'Sky Skiff',
          type_line: 'Artifact - Vehicle',
          oracle_text: 'Crew 2',
        },
      },
      {
        id: 'crewer_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'crewer_card_1',
          name: 'Skilled Pilot',
          type_line: 'Creature - Human Pilot',
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

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'vehicle_1', abilityId: 'vehicle_card_1-crew-0' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe('target_selection');
    expect(step.crewAbility).toBe(true);
    expect(step.crewPower).toBe(2);
    expect((step.validTargets || []).map((entry: any) => String(entry?.id))).toEqual(['crewer_1']);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['crewer_1'] });

    const vehicle = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'vehicle_1');
    const crewer = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'crewer_1');
    expect(Boolean(vehicle?.crewed)).toBe(true);
    expect((vehicle?.grantedTypes || []).map((entry: any) => String(entry))).toContain('Creature');
    expect(Boolean(crewer?.tapped)).toBe(true);
  });

  it('activates level up through the parser-emitted id and adds a level counter', async () => {
    const gameId = 'test_levelup_generic_activation';
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
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
    };
    (game.state as any).battlefield = [
      {
        id: 'leveler_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'leveler_card_1',
          name: 'Joraga Treespeaker',
          type_line: 'Creature - Elf Druid',
          oracle_text: 'Level up {1}{G}\nLEVEL 1-4\nElves you control have "{T}: Add {G}{G}."',
          power: '1',
          toughness: '1',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'leveler_1', abilityId: 'leveler_card_1-level-up-0' });

    expect(((game.state as any).stack || [])).toHaveLength(1);
    const leveler = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'leveler_1');
    expect(leveler?.counters?.level ?? 0).toBe(0);
    expect((game.state as any).manaPool?.[playerId]?.green).toBe(0);
    expect((game.state as any).manaPool?.[playerId]?.colorless).toBe(0);

    game.resolveTopOfStack();

    expect(((game.state as any).stack || [])).toHaveLength(0);
    expect(leveler?.counters?.level).toBe(1);
  });

  it('activates outlast through the parser-emitted id and adds a +1/+1 counter', async () => {
    const gameId = 'test_outlast_generic_activation';
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
    (game.state as any).manaPool = {
      [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'outlast_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'outlast_card_1',
          name: 'Abzan Falconer',
          type_line: 'Creature - Human Soldier',
          oracle_text: 'Outlast {W}',
          power: '2',
          toughness: '3',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'outlast_1', abilityId: 'outlast_card_1-outlast-0' });

    expect(((game.state as any).stack || [])).toHaveLength(1);
    const outlastCreature = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'outlast_1');
    expect(Boolean(outlastCreature?.tapped)).toBe(true);
    expect(outlastCreature?.counters?.['+1/+1'] ?? 0).toBe(0);
    expect((game.state as any).manaPool?.[playerId]?.white).toBe(0);

    game.resolveTopOfStack();

    expect(((game.state as any).stack || [])).toHaveLength(0);
    expect(outlastCreature?.counters?.['+1/+1']).toBe(1);
  });
});