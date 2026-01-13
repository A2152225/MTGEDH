import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerJoinForcesHandlers } from '../src/socket/join-forces.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

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
    registerJoinForcesHandlers(io, s1.socket);
    registerJoinForcesHandlers(io, s2.socket);

    // Initiate Join Forces
    await s1.handlers['initiateJoinForces']({
      gameId,
      cardName: 'Collective Voyage',
      effectDescription: 'Each player may pay any amount of mana. Search for X basics.',
    });

    const req = emitted.find(e => e.room === gameId && e.event === 'joinForcesRequest');
    expect(req).toBeDefined();
    const joinForcesId = req!.payload.id;

    // Both players contribute 1 -> total = 2
    await s1.handlers['contributeJoinForces']({ gameId, joinForcesId, amount: 1 });
    await s2.handlers['contributeJoinForces']({ gameId, joinForcesId, amount: 1 });

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
    registerJoinForcesHandlers(io, s1.socket);
    registerJoinForcesHandlers(io, s2.socket);

    // Initiate Tempting Offer
    await s1.handlers['initiateTemptingOffer']({
      gameId,
      cardName: 'Tempt with Discovery',
      effectDescription: 'Search for a land; opponents may also search.',
    });

    const req = emitted.find(e => e.room === gameId && e.event === 'temptingOfferRequest');
    expect(req).toBeDefined();
    const temptingOfferId = req!.payload.id;

    // Opponent accepts
    await s2.handlers['respondTemptingOffer']({ gameId, temptingOfferId, accept: true });

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
