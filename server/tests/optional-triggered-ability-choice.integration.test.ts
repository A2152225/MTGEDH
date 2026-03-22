import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
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

function pushOptionalSoulAttendantTrigger(game: any, playerId: string) {
  (game.state as any).stack = [
    {
      id: 'trigger_1',
      type: 'triggered_ability',
      controller: playerId,
      source: 'soul_attendant_1',
      sourceName: "Soul's Attendant",
      description: 'You may gain 1 life.',
      effect: 'You may gain 1 life.',
      triggerType: 'creature_etb',
      mandatory: false,
      requiresChoice: true,
    },
  ];
}

describe('optional triggered ability integration', () => {
  const gameId = 'test_optional_triggered_ability_integration';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('queues an option choice and resolves the trigger only after accepting', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    pushOptionalSoulAttendantTrigger(game, playerId);

    game.resolveTopOfStack();

    expect((game.state as any).life[playerId]).toBe(40);
    expect((game.state as any).stack).toHaveLength(0);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((queuedStep: any) => (queuedStep as any).optionalTriggeredAbilityPrompt === true);
    expect(step).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: ['yes'],
      cancelled: false,
    });

    expect((game.state as any).life[playerId]).toBe(41);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('queues an option choice and skips the trigger when declined', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    pushOptionalSoulAttendantTrigger(game, playerId);

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((queuedStep: any) => (queuedStep as any).optionalTriggeredAbilityPrompt === true);
    expect(step).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: ['no'],
      cancelled: true,
    });

    expect((game.state as any).life[playerId]).toBe(40);
    expect((game.state as any).stack).toHaveLength(0);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('auto-resolves optional stack triggers when a saved always_yes shortcut matches', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).triggerShortcuts = {
      [playerId]: [
        { cardName: "Soul's Attendant", playerId, preference: 'always_yes' },
      ],
    };
    pushOptionalSoulAttendantTrigger(game, playerId);

    game.resolveTopOfStack();

    expect((game.state as any).life[playerId]).toBe(41);
    expect((game.state as any).stack).toHaveLength(0);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('auto-declines optional stack triggers when a saved always_no shortcut matches', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).triggerShortcuts = {
      [playerId]: [
        { cardName: "Soul's Attendant", playerId, preference: 'always_no' },
      ],
    };
    pushOptionalSoulAttendantTrigger(game, playerId);

    game.resolveTopOfStack();

    expect((game.state as any).life[playerId]).toBe(40);
    expect((game.state as any).stack).toHaveLength(0);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('auto-resolves Curiosity-style optional stack triggers when a saved always_yes shortcut matches', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).triggerShortcuts = {
      [playerId]: [
        { cardName: 'Curiosity', playerId, preference: 'always_yes' },
      ],
    };
    (game.state as any).stack = [
      {
        id: 'trigger_curiosity_1',
        type: 'triggered_ability',
        controller: playerId,
        source: 'curiosity_1',
        sourceName: 'Curiosity',
        description: 'You may draw a card.',
        effect: 'You may draw a card.',
        triggerType: 'combat_damage',
        mandatory: false,
        requiresChoice: true,
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [
          {
            id: 'drawn_card_1',
            name: 'Island',
            type_line: 'Basic Land — Island',
            zone: 'library',
          },
        ],
        libraryCount: 1,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    game.resolveTopOfStack();

    expect((game.state as any).pendingDraws?.[playerId]).toBe(1);
    expect((game.state as any).zones[playerId].handCount).toBe(0);
    expect((game.state as any).zones[playerId].libraryCount).toBe(1);
    expect((game.state as any).stack).toHaveLength(0);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

});