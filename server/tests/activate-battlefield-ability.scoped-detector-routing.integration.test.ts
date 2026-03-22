import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
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

describe('activateBattlefieldAbility detector routing uses selected ability text (integration)', () => {
  const gameId = 'test_activate_battlefield_ability_scoped_detector_routing';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('does not let a later counter ability hijack an earlier generic ability activation', async () => {
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [{ id: 'drawn_1', name: 'Drawn Card', type_line: 'Artifact', zone: 'library' }],
        libraryCount: 1,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'src_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'split_1',
          name: 'Split Focus Engine',
          type_line: 'Artifact',
          oracle_text: '{T}: Draw a card.\n{2}: Put a +1/+1 counter on target creature.',
        },
      },
      {
        id: 'creature_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'creature_card_1',
          name: 'Test Bear',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(0);

    const source = (game.state as any).battlefield.find((permanent: any) => permanent.id === 'src_1');
    expect(Boolean(source?.tapped)).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.type)).toBe('ability');
    expect(String(stack[0]?.source)).toBe('src_1');
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('draw a card');
    expect(String(stack[0]?.description || '').toLowerCase()).not.toContain('+1/+1 counter');
  });

  it('does not let a later sacrifice-to-draw ability hijack an earlier generic ability activation', async () => {
    const sacrificeDrawGameId = `${gameId}_sacrifice_draw`;
    ResolutionQueueManager.removeQueue(sacrificeDrawGameId);
    games.delete(sacrificeDrawGameId as any);

    createGameIfNotExists(sacrificeDrawGameId, 'commander', 40);
    const game = ensureGame(sacrificeDrawGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [{ id: 'drawn_2', name: 'Drawn Card', type_line: 'Artifact', zone: 'library' }],
        libraryCount: 1,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'src_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'split_2',
          name: 'Forked Canopy Device',
          type_line: 'Artifact',
          oracle_text: '{T}: Draw a card.\n{1}, {T}, Sacrifice Forked Canopy Device: Draw a card.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(sacrificeDrawGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: sacrificeDrawGameId, permanentId: 'src_2', abilityId: 'src_2-ability-0' });

    const queue = ResolutionQueueManager.getQueue(sacrificeDrawGameId);
    expect(queue.steps).toHaveLength(0);

    const sourceStillOnBattlefield = (game.state as any).battlefield.find((permanent: any) => permanent.id === 'src_2');
    expect(sourceStillOnBattlefield).toBeDefined();
    expect(Boolean(sourceStillOnBattlefield?.tapped)).toBe(true);

    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(graveyard).toHaveLength(0);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('draw a card');
  });

  it('routes a generic move-counter ability through COUNTER_MOVEMENT without relying on the legacy fallback branch', async () => {
    const moveCounterGameId = `${gameId}_move_counter`;
    ResolutionQueueManager.removeQueue(moveCounterGameId);
    games.delete(moveCounterGameId as any);

    createGameIfNotExists(moveCounterGameId, 'commander', 40);
    const game = ensureGame(moveCounterGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'nest_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 1 },
        card: {
          id: 'nesting_grounds_1',
          name: 'Nesting Grounds',
          type_line: 'Land',
          oracle_text: '{1}, {T}: Move a counter from target permanent you control onto a second target permanent.',
        },
      },
      {
        id: 'perm_with_counter',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 2 },
        card: {
          id: 'counter_source_1',
          name: 'Charged Relic',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
      {
        id: 'perm_target',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'counter_target_1',
          name: 'Empty Relic',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(moveCounterGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: moveCounterGameId, permanentId: 'nest_1', abilityId: 'nest_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(moveCounterGameId);
    expect(queue.steps).toHaveLength(1);

    const step = queue.steps[0] as any;
    expect(step.type).toBe('counter_movement');
    expect(step.sourceId).toBe('nest_1');

    const sourcePermanent = (game.state as any).battlefield.find((permanent: any) => permanent.id === 'nest_1');
    expect(Boolean(sourcePermanent?.tapped)).toBe(true);
  });
});
