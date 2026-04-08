import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stack.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

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

describe('Protean Hulk library search support', () => {
  const integrationGameId = 'test_protean_hulk_validate_before_complete';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(integrationGameId);
    ResolutionQueueManager.removeQueue('t_protean_hulk_trigger_search');
    games.delete(integrationGameId as any);
  });

  it('queues a library search step with a total mana value cap when Protean Hulk resolves', () => {
    const gameId = 't_protean_hulk_trigger_search';
    const game = createInitialGameState(gameId);
    const p1 = 'p1';

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.importDeckResolved(p1 as any, [
      { id: 'c1', name: 'One Drop', type_line: 'Creature — Elf', power: '1', toughness: '1', cmc: 1, zone: 'library' },
      { id: 'c2', name: 'Two Drop', type_line: 'Creature — Bear', power: '2', toughness: '2', cmc: 2, zone: 'library' },
      { id: 'c3', name: 'Land Card', type_line: 'Land', cmc: 0, zone: 'library' },
      { id: 'c4', name: 'Four Drop', type_line: 'Creature — Beast', power: '4', toughness: '4', cmc: 4, zone: 'library' },
    ] as any);

    executeTriggerEffect(
      game as any,
      p1 as any,
      'Protean Hulk',
      'search your library for any number of creature cards with total mana value 6 or less and put them onto the battlefield. Then shuffle.',
      { source: 'protean_perm_1', permanentId: 'protean_perm_1' },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1 as any);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.type).toBe(ResolutionStepType.LIBRARY_SEARCH);
    expect((steps[0] as any).destination).toBe('battlefield');
    expect((steps[0] as any).maxTotalManaValue).toBe(6);
    expect((steps[0] as any).filter).toMatchObject({ types: ['creature'] });
    expect((steps[0] as any).availableCards.map((card: any) => card.id)).toEqual(['c1', 'c2', 'c4']);
  });

  it('rejects over-budget creature selections without consuming the step', async () => {
    createGameIfNotExists(integrationGameId, 'commander', 40);
    const game = ensureGame(integrationGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).battlefield = [];

    const libraryCards = [
      { id: 'c4', name: 'Four Drop', type_line: 'Creature — Beast', power: '4', toughness: '4', cmc: 4, zone: 'library' },
      { id: 'c3', name: 'Three Drop', type_line: 'Creature — Wizard', power: '3', toughness: '3', cmc: 3, zone: 'library' },
      { id: 'c2', name: 'Two Drop', type_line: 'Creature — Knight', power: '2', toughness: '2', cmc: 2, zone: 'library' },
    ];
    (game as any).libraries = new Map();
    (game as any).libraries.set(p1, [...libraryCards]);

    (game.state as any).zones = {
      [p1]: {
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: libraryCards.length,
      },
    };

    ResolutionQueueManager.addStep(integrationGameId, {
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId: p1 as any,
      description: 'Protean Hulk: Search your library for any number of creature cards with total mana value 6 or less.',
      mandatory: false,
      sourceId: 'protean_perm_1',
      sourceName: 'Protean Hulk',
      searchCriteria: 'any number of creature cards with total mana value 6 or less',
      minSelections: 0,
      maxSelections: 3,
      maxTotalManaValue: 6,
      destination: 'battlefield',
      reveal: true,
      shuffleAfter: true,
      availableCards: libraryCards.map((card) => ({ ...card })),
      filter: { types: ['creature'] },
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(integrationGameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(integrationGameId);
    const step = queue.steps.find((entry: any) => entry.type === 'library_search');
    const stepId = String((step as any).id);

    await handlers['submitResolutionResponse']({
      gameId: integrationGameId,
      stepId,
      selections: ['c4', 'c3'],
    });

    const invalid = emitted.find((entry) => entry.event === 'error' && entry.payload?.code === 'INVALID_SELECTION_TOTAL_MANA_VALUE');
    expect(invalid?.payload?.message).toContain('exceeds 6');
    expect(ResolutionQueueManager.getQueue(integrationGameId).steps.some((entry: any) => String(entry.id) === stepId)).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId: integrationGameId,
      stepId,
      selections: ['c4', 'c2'],
    });

    expect(ResolutionQueueManager.getQueue(integrationGameId).steps.some((entry: any) => String(entry.id) === stepId)).toBe(false);
    expect((game.state as any).battlefield.map((permanent: any) => permanent.card?.id)).toEqual(['c4', 'c2']);
  });
});