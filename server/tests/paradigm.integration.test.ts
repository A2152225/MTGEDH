import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
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

function buildParadigmCard(playerId: string) {
  return {
    id: 'paradigm_card_1',
    name: 'Germination Practicum',
    mana_cost: '{3}{G}{G}',
    type_line: 'Sorcery — Lesson',
    oracle_text:
      'Put two +1/+1 counters on each creature you control.\nParadigm (Then exile this spell. After you first resolve a spell with this name, you may cast a copy of it from exile without paying its mana cost at the beginning of each of your first main phases.)',
    owner: playerId,
    zone: 'exile',
    paradigmActive: true,
    paradigmController: playerId,
  };
}

function seedParadigmSourceState(game: any, playerId: string) {
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40 };
  (game.state as any).turnPlayer = playerId;
  (game.state as any).activePlayer = playerId;
  (game.state as any).turnNumber = 3;
  (game.state as any).phase = 'draw';
  (game.state as any).step = 'DRAW';
  (game.state as any).battlefield = [];
  (game.state as any).stack = [];
  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [buildParadigmCard(playerId)],
      exileCount: 1,
    },
  };
}

function seedParadigmTriggerState(game: any, playerId: string) {
  seedParadigmSourceState(game, playerId);
  (game.state as any).phase = 'precombat_main';
  (game.state as any).step = 'MAIN1';
  (game.state as any).stack = [
    {
      id: 'trigger_1',
      type: 'triggered_ability',
      controller: playerId,
      source: 'paradigm_card_1',
      sourceName: 'Germination Practicum',
      description: 'You may cast a copy of Germination Practicum from exile without paying its mana cost.',
      effect: 'You may cast a copy of it from exile without paying its mana cost.',
      triggerType: 'paradigm',
      mandatory: true,
      paradigmCardId: 'paradigm_card_1',
      card: buildParadigmCard(playerId),
    },
  ];
}

describe('Paradigm integration', () => {
  const gameId = 'test_paradigm_integration';
  const playerId = 'p1';

  async function resetGame(targetGameId: string) {
    ResolutionQueueManager.removeQueue(targetGameId);
    games.delete(targetGameId as any);
    await deleteGame(targetGameId);
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('adds a Paradigm trigger at the beginning of your precombat main phase', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedParadigmSourceState(game, playerId);
    game.nextStep();

    expect((game.state as any).step).toBe('MAIN1');
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0]).toMatchObject({
      sourceName: 'Germination Practicum',
      triggerType: 'paradigm',
      paradigmCardId: 'paradigm_card_1',
    });
  });

  it('does not add a Paradigm trigger during upkeep', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedParadigmSourceState(game, playerId);
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UNTAP';

    game.nextStep();

    expect((game.state as any).step).toBe('UPKEEP');
    expect((game.state as any).stack).toHaveLength(0);
  });

  it('queues a cast-from-exile prompt for a temporary Paradigm copy and removes it on decline', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedParadigmTriggerState(game, playerId);
    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps[0] as any;
    expect(step).toBeDefined();
    expect(step.castFromExileCardId).toBeDefined();
    expect((game.state as any).zones[playerId].exile).toHaveLength(2);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: ['decline'],
      cancelled: false,
    });

    expect((game.state as any).zones[playerId].exile).toHaveLength(1);
    expect((game.state as any).zones[playerId].exile[0].id).toBe('paradigm_card_1');
    expect((game.state as any).stack).toHaveLength(0);
  });

  it('casts a Paradigm copy from exile and the copy ceases after resolution', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedParadigmTriggerState(game, playerId);
    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps[0] as any;
    expect(step).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: ['cast'],
      cancelled: false,
    });

    const paymentStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((entry: any) => entry.type === 'mana_payment_choice' && (entry as any).spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: { payment: [] },
      cancelled: false,
    });

    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0]).toMatchObject({
      controller: playerId,
      card: expect.objectContaining({
        isCopy: true,
        copiedFromCardId: 'paradigm_card_1',
        name: 'Germination Practicum',
      }),
    });
    game.resolveTopOfStack();

    expect((game.state as any).zones[playerId].exile).toHaveLength(1);
    expect((game.state as any).zones[playerId].graveyard).toHaveLength(0);
    expect((game.state as any).stack).toHaveLength(0);
  });
});
