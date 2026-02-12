import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('Legacy cleanup: pendingLibrarySearch is not created', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    // Ensure no cross-test queue bleed
    ResolutionQueueManager.removeQueue('test_collective_voyage');
    ResolutionQueueManager.removeQueue('test_tempt_with_discovery');
    ResolutionQueueManager.removeQueue('test_library_search_invalid_selection');
    ResolutionQueueManager.removeQueue('test_library_search_split_destination');
    games.delete('test_collective_voyage' as any);
    games.delete('test_tempt_with_discovery' as any);
    games.delete('test_library_search_invalid_selection' as any);
    games.delete('test_library_search_split_destination' as any);
  });

  it('LIBRARY_SEARCH invalid selection does not consume the step', async () => {
    const gameId = 'test_library_search_invalid_selection';
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: 'p1', spectator: false },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const s1 = createMockSocket('p1', emitted);
    registerResolutionHandlers(io as any, s1.socket);

    const searchStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId: 'p1' as any,
      description: 'Search your library for a basic land card',
      mandatory: true,
      sourceName: 'Test Tutor',
      minSelections: 1,
      maxSelections: 1,
      destination: 'hand',
      remainderDestination: 'none',
      shuffleAfter: false,
      availableCards: [
        { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest' },
      ],
      nonSelectableCards: [],
    } as any);

    expect(typeof s1.handlers['submitResolutionResponse']).toBe('function');

    // Invalid: selected card id not in availableCards.
    await s1.handlers['submitResolutionResponse']({
      gameId,
      stepId: searchStep.id,
      selections: ['not_a_real_card'],
      cancelled: false,
    });

    // Step should remain pending.
    const stepsAfter = ResolutionQueueManager.getStepsForPlayer(gameId, 'p1' as any);
    expect(stepsAfter.some(s => s.id === searchStep.id)).toBe(true);
  });

  it('LIBRARY_SEARCH splitDestination preserves split assignments from client', async () => {
    const gameId = 'test_library_search_split_destination';
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: 'p1', spectator: false },
    ];

    const libraries: Map<string, any[]> = ((game as any).libraries = (game as any).libraries || new Map());
    libraries.set('p1', [
      { id: 'land_a', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' },
      { id: 'land_b', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' },
    ]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const s1 = createMockSocket('p1', emitted);
    registerResolutionHandlers(io as any, s1.socket);

    const searchStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId: 'p1' as any,
      description: "Search your library for up to two basic land cards. Put one onto the battlefield tapped and the other into your hand.",
      mandatory: true,
      sourceName: 'Test Split Tutor',
      minSelections: 2,
      maxSelections: 2,
      destination: 'split',
      splitDestination: true,
      toBattlefield: 1,
      toHand: 1,
      entersTapped: true,
      remainderDestination: 'none',
      shuffleAfter: false,
      availableCards: [
        { id: 'land_a', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' },
        { id: 'land_b', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' },
      ],
      nonSelectableCards: [],
    } as any);

    await s1.handlers['submitResolutionResponse']({
      gameId,
      stepId: searchStep.id,
      selections: ['land_a', 'land_b'],
      cancelled: false,
      splitAssignments: { toBattlefield: ['land_a'], toHand: ['land_b'] },
      moveTo: 'split',
    });

    const zones = (game.state as any).zones || {};
    const z = zones['p1'] || {};
    expect(Array.isArray(z.hand)).toBe(true);
    expect((z.hand as any[]).some((c: any) => c?.id === 'land_b')).toBe(true);

    const battlefield = Array.isArray((game.state as any).battlefield) ? (game.state as any).battlefield : [];
    expect(battlefield.some((p: any) => p?.card?.id === 'land_a')).toBe(true);
  });

  it('Collective Voyage creates LIBRARY_SEARCH steps (no pendingLibrarySearch)', async () => {
    const gameId = 'test_collective_voyage';
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    // Two real players
    (game.state as any).players = [
      { id: 'p1', spectator: false },
      { id: 'p2', spectator: false },
    ];

    // Seed libraries so the search step has availableCards
    const libraries: Map<string, any[]> = ((game as any).libraries = (game as any).libraries || new Map());
    libraries.set('p1', [
      { id: 'p1_forest', name: 'Forest', type_line: 'Basic Land — Forest' },
      { id: 'p1_bear', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
    ]);
    libraries.set('p2', [
      { id: 'p2_island', name: 'Island', type_line: 'Basic Land — Island' },
      { id: 'p2_spell', name: 'Lightning Bolt', type_line: 'Instant' },
    ]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);

    const s1 = createMockSocket('p1', emitted);
    const s2 = createMockSocket('p2', emitted);
    registerResolutionHandlers(io as any, s1.socket);
    registerResolutionHandlers(io as any, s2.socket);

    // In the Resolution Queue architecture, Join Forces is represented as JOIN_FORCES steps.
    const p1Step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.JOIN_FORCES,
      playerId: 'p1' as any,
      description: 'Collective Voyage: You may contribute mana',
      mandatory: false,
      sourceName: 'Collective Voyage',
      cardName: 'Collective Voyage',
      initiator: 'p1',
      availableMana: 10,
      isInitiator: true,
    } as any);
    const p2Step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.JOIN_FORCES,
      playerId: 'p2' as any,
      description: 'Collective Voyage: You may contribute mana',
      mandatory: false,
      sourceName: 'Collective Voyage',
      cardName: 'Collective Voyage',
      initiator: 'p1',
      availableMana: 10,
      isInitiator: false,
    } as any);

    // Both players contribute 1 -> total = 2
    await s1.handlers['submitResolutionResponse']({ gameId, stepId: p1Step.id, selections: { amount: 1 } });
    await s2.handlers['submitResolutionResponse']({ gameId, stepId: p2Step.id, selections: { amount: 1 } });

    // Legacy field should not be created anymore
    expect((game.state as any).pendingLibrarySearch).toBeUndefined();

    // Resolution Queue should have library search steps for both players
    const p1Steps = ResolutionQueueManager.getStepsForPlayer(gameId, 'p1' as any);
    const p2Steps = ResolutionQueueManager.getStepsForPlayer(gameId, 'p2' as any);

    expect(p1Steps.some(s => s.type === ResolutionStepType.LIBRARY_SEARCH)).toBe(true);
    expect(p2Steps.some(s => s.type === ResolutionStepType.LIBRARY_SEARCH)).toBe(true);

    const p1Search = p1Steps.find(s => s.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    expect(p1Search.sourceName).toBe('Collective Voyage');
    expect(p1Search.maxSelections).toBe(2);
    expect(p1Search.destination).toBe('battlefield');
    expect(p1Search.entersTapped).toBe(true);
  });

  it('Tempt with Discovery creates LIBRARY_SEARCH steps (no pendingLibrarySearch)', async () => {
    const gameId = 'test_tempt_with_discovery';
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: 'p1', spectator: false },
      { id: 'p2', spectator: false },
    ];

    const libraries: Map<string, any[]> = ((game as any).libraries = (game as any).libraries || new Map());
    libraries.set('p1', [
      { id: 'p1_land', name: 'Temple Garden', type_line: 'Land — Forest Plains' },
      { id: 'p1_spell', name: 'Opt', type_line: 'Instant' },
    ]);
    libraries.set('p2', [
      { id: 'p2_land', name: 'Breeding Pool', type_line: 'Land — Forest Island' },
      { id: 'p2_spell', name: 'Ponder', type_line: 'Sorcery' },
    ]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);

    const s1 = createMockSocket('p1', emitted);
    const s2 = createMockSocket('p2', emitted);
    registerResolutionHandlers(io as any, s1.socket);
    registerResolutionHandlers(io as any, s2.socket);

    // In the Resolution Queue architecture, Tempting Offer is represented as TEMPTING_OFFER steps.
    const opponentStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TEMPTING_OFFER,
      playerId: 'p2' as any,
      description: 'Tempt with Discovery: Accept?',
      mandatory: false,
      sourceName: 'Tempt with Discovery',
      cardName: 'Tempt with Discovery',
      initiator: 'p1',
      isOpponent: true,
    } as any);

    // Opponent accepts
    await s2.handlers['submitResolutionResponse']({ gameId, stepId: opponentStep.id, selections: true });

    // Legacy field should not be created anymore
    expect((game.state as any).pendingLibrarySearch).toBeUndefined();

    const p1Steps = ResolutionQueueManager.getStepsForPlayer(gameId, 'p1' as any);
    const p2Steps = ResolutionQueueManager.getStepsForPlayer(gameId, 'p2' as any);

    const p1Search = p1Steps.find(s => s.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    const p2Search = p2Steps.find(s => s.type === ResolutionStepType.LIBRARY_SEARCH) as any;

    expect(p1Search).toBeDefined();
    expect(p2Search).toBeDefined();
    expect(p1Search.sourceName).toBe('Tempt with Discovery');
    expect(p2Search.sourceName).toBe('Tempt with Discovery');

    // Initiator gets 1 + acceptedCount = 2 max selections, opponent gets 1
    expect(p1Search.maxSelections).toBe(2);
    expect(p2Search.maxSelections).toBe(1);
  });
});
