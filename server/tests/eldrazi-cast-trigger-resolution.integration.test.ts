import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src/index.js';
import '../src/state/modules/priority.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
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
  await deleteGame(gameId);
}

describe('Eldrazi on-cast triggers (integration)', () => {
  const gameId = 'test_eldrazi_cast_triggers';
  const trackedGameIds = new Set<string>();

  function trackGameId(trackedGameId: string) {
    trackedGameIds.add(trackedGameId);
    ResolutionQueueManager.removeQueue(trackedGameId);
    games.delete(trackedGameId as any);
    return trackedGameId;
  }

  async function resetTrackedGames() {
    for (const trackedGameId of trackedGameIds) {
      await resetGame(trackedGameId);
    }
    trackedGameIds.clear();
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    trackedGameIds.clear();
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetTrackedGames();
    await resetGame(gameId);
  });

  it('queues Kozilek on-cast trigger on the stack and draws four cards when it resolves', async () => {
    const persistentGameId = trackGameId(`${gameId}_kozilek`);
    createGameIfNotExists(persistentGameId, 'commander', 40);
    const game = ensureGame(persistentGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'kozilek_id',
            name: 'Kozilek, Butcher of Truth',
            type_line: 'Legendary Creature — Eldrazi',
            oracle_text: 'When you cast this spell, draw four cards.',
            mana_cost: '{10}',
          }
        ],
        handCount: 1,
        library: [
          { id: 'card_1', name: 'Plains', zone: 'library' },
          { id: 'card_2', name: 'Plains', zone: 'library' },
          { id: 'card_3', name: 'Plains', zone: 'library' },
          { id: 'card_4', name: 'Plains', zone: 'library' },
        ],
        libraryCount: 4,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 10, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).stack = [];

    (game as any).libraries = (game as any).libraries || new Map();
    (game as any).libraries.set(playerId, [
      { id: 'card_1', name: 'Plains', zone: 'library' },
      { id: 'card_2', name: 'Plains', zone: 'library' },
      { id: 'card_3', name: 'Plains', zone: 'library' },
      { id: 'card_4', name: 'Plains', zone: 'library' },
    ]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, persistentGameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['castSpellFromHand']({ gameId: persistentGameId, cardId: 'kozilek_id' });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(2); // The Kozilek spell itself, and Kozilek's cast trigger on top!
    
    const trigger = stack.find((item: any) => item.type === 'triggered_ability');
    expect(trigger).toBeDefined();
    expect(trigger.sourceName).toBe('Kozilek, Butcher of Truth');
    expect(trigger.description).toContain('draw four cards');

    // Now resolve Kozilek's cast trigger
    game.resolveTopOfStack();

    expect((game.state as any).zones[playerId].hand).toHaveLength(4);
    expect((game.state as any).stack).toHaveLength(1); // Only Kozilek spell left on stack
  });

  it('queues on-cast draw trigger from oracle text when card name is not in Eldrazi table', async () => {
    const persistentGameId = trackGameId(`${gameId}_kozilek_oracle_generic`);
    createGameIfNotExists(persistentGameId, 'commander', 40);
    const game = ensureGame(persistentGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'generic_eldrazi_id',
            name: 'Not In Eldrazi Table',
            type_line: 'Legendary Creature — Eldrazi',
            oracle_text: 'When you cast this spell, draw four cards.',
            mana_cost: '{10}',
          },
        ],
        handCount: 1,
        library: [
          { id: 'card_1', name: 'Plains', zone: 'library' },
          { id: 'card_2', name: 'Plains', zone: 'library' },
          { id: 'card_3', name: 'Plains', zone: 'library' },
          { id: 'card_4', name: 'Plains', zone: 'library' },
        ],
        libraryCount: 4,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 10, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).stack = [];
    (game as any).libraries = (game as any).libraries || new Map();
    (game as any).libraries.set(playerId, [
      { id: 'card_1', name: 'Plains', zone: 'library' },
      { id: 'card_2', name: 'Plains', zone: 'library' },
      { id: 'card_3', name: 'Plains', zone: 'library' },
      { id: 'card_4', name: 'Plains', zone: 'library' },
    ]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, persistentGameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['castSpellFromHand']({ gameId: persistentGameId, cardId: 'generic_eldrazi_id' });

    const trigger = ((game.state as any).stack || []).find((item: any) => item.type === 'triggered_ability');
    expect(trigger).toBeDefined();
    expect(trigger.description).toContain('draw four cards');

    game.resolveTopOfStack();
    expect((game.state as any).zones[playerId].hand).toHaveLength(4);
  });

  it('queues Ulamog on-cast trigger on the stack and requires target selection for destroy', async () => {
    const persistentGameId = trackGameId(`${gameId}_ulamog_gyre`);
    createGameIfNotExists(persistentGameId, 'commander', 40);
    const game = ensureGame(persistentGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'target_perm_1',
        controller: 'p2',
        owner: 'p2',
        card: { id: 'target_card_1', name: 'Sylvan Library', type_line: 'Enchantment' },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'ulamog_id',
            name: 'Ulamog, the Infinite Gyre',
            type_line: 'Legendary Creature — Eldrazi',
            oracle_text: 'When you cast this spell, destroy target permanent.',
            mana_cost: '{11}',
          }
        ],
        handCount: 1,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 11, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, persistentGameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['castSpellFromHand']({ gameId: persistentGameId, cardId: 'ulamog_id' });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(2);

    const trigger = stack.find((item: any) => item.type === 'triggered_ability');
    expect(trigger).toBeDefined();
    expect(trigger.action).toBe('destroy_target_permanent');
    expect(trigger.requiresTarget).toBe(true);

    // Resolving the top of stack will queue a TARGET_SELECTION step on the resolution queue
    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(persistentGameId);
    expect(queue.steps).toHaveLength(1);
    expect(queue.steps[0].type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((queue.steps[0] as any).action).toBe('destroy_target_permanent');
  });

  it('queues Emrakul, the Aeons Torn on-cast trigger on the stack and adds extra turn on resolution', async () => {
    const persistentGameId = trackGameId(`${gameId}_emrakul_torn`);
    createGameIfNotExists(persistentGameId, 'commander', 40);
    const game = ensureGame(persistentGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'emrakul_torn_id',
            name: 'Emrakul, the Aeons Torn',
            type_line: 'Legendary Creature — Eldrazi',
            oracle_text: "This spell can't be countered. Take an extra turn after this one.",
            mana_cost: '{15}',
          }
        ],
        handCount: 1,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 15, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, persistentGameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['castSpellFromHand']({ gameId: persistentGameId, cardId: 'emrakul_torn_id' });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(2);

    const trigger = stack.find((item: any) => item.type === 'triggered_ability');
    expect(trigger).toBeDefined();

    // Resolving the top of stack will grant an extra turn
    game.resolveTopOfStack();

    const extraTurns = (game.state as any).extraTurns || [];
    expect(extraTurns).toHaveLength(1);
    expect(extraTurns[0].playerId).toBe(playerId);
  });

  it('queues Emrakul, the Promised End on-cast trigger on the stack, prompts opponent choice, and adds control next turn + drawback turn', async () => {
    const persistentGameId = trackGameId(`${gameId}_emrakul_promise`);
    createGameIfNotExists(persistentGameId, 'commander', 40);
    const game = ensureGame(persistentGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'emrakul_promise_id',
            name: 'Emrakul, the Promised End',
            type_line: 'Legendary Creature — Eldrazi',
            oracle_text: "When you cast this spell, you gain control of target opponent during that player's next turn. After that turn, that player takes an extra turn.",
            mana_cost: '{13}',
          }
        ],
        handCount: 1,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 13, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, persistentGameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['castSpellFromHand']({ gameId: persistentGameId, cardId: 'emrakul_promise_id' });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(2);

    const trigger = stack.find((item: any) => item.type === 'triggered_ability');
    expect(trigger).toBeDefined();
    expect(trigger.action).toBe('gain_control_target_opponent');

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(persistentGameId);
    expect(queue.steps).toHaveLength(1);
    expect(queue.steps[0].type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((queue.steps[0] as any).action).toBe('gain_control_target_opponent');

    // Respond selecting opponentId
    await handlers['submitResolutionResponse']({
      gameId: persistentGameId,
      stepId: queue.steps[0].id,
      selections: [opponentId],
    });

    const stateAny = game.state as any;
    expect(stateAny.controlledPlayerNextTurn).toBeDefined();
    expect(stateAny.controlledPlayerNextTurn[opponentId]).toBe(playerId);

    const extraTurns = stateAny.extraTurns || [];
    expect(extraTurns).toHaveLength(1);
    expect(extraTurns[0].playerId).toBe(opponentId);
  });
});
