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

function seedReboundState(game: any, playerId: string) {
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40 };
  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [
        {
          id: 'rebound_card_1',
          name: 'Staggershock',
          type_line: 'Instant',
          oracle_text: 'Staggershock deals 2 damage to any target. Rebound',
          reboundPending: true,
          reboundTriggered: true,
          zone: 'exile',
        },
      ],
      exileCount: 1,
    },
  };
  (game.state as any).stack = [
    {
      id: 'trigger_1',
      type: 'triggered_ability',
      controller: playerId,
      source: 'rebound_source_1',
      sourceName: 'Staggershock',
      description: 'At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.',
      effect: 'You may cast this card from exile without paying its mana cost.',
      triggerType: 'rebound',
      mandatory: true,
      reboundCardId: 'rebound_card_1',
      card: {
        id: 'rebound_card_1',
        name: 'Staggershock',
        type_line: 'Instant',
        oracle_text: 'Staggershock deals 2 damage to any target. Rebound',
      },
    },
  ];
}

describe('Rebound may ability integration', () => {
  const gameId = 'test_rebound_may_ability_integration';
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

  it('uses the shared may prompt and casts the rebound spell on accept', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedReboundState(game, playerId);
    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((queuedStep: any) => (queuedStep as any).mayAbilityPrompt === true);
    expect(step).toBeDefined();
    expect((step as any).sourceName).toBe('Staggershock');
    expect((game.state as any).zones[playerId].exile).toHaveLength(1);

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

    expect((game.state as any).zones[playerId].exile).toHaveLength(0);
    expect((game.state as any).zones[playerId].graveyard).toHaveLength(0);
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0].castFromRebound).toBe(true);
  });

  it('uses the shared may prompt and moves the rebound spell to graveyard on decline', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedReboundState(game, playerId);
    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((queuedStep: any) => (queuedStep as any).mayAbilityPrompt === true);
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

    expect((game.state as any).zones[playerId].exile).toHaveLength(0);
    expect((game.state as any).zones[playerId].graveyard).toHaveLength(1);
    expect((game.state as any).zones[playerId].graveyard[0].name).toBe('Staggershock');
    expect((game.state as any).stack).toHaveLength(0);
  });
});