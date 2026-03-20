import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
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
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('spell-cast reveal/cast queue flow (integration)', () => {
  const gameId = 'test_spell_cast_reveal_cast_resolution';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('moves the triggering spell to the bottom, reveals until a nonland, and offers a free cast', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnNumber = 3;
    (game as any).libraries = new Map();
    (game as any).libraries.set(p1, [
      { id: 'land_1', name: 'Mountain', type_line: 'Basic Land — Mountain', zone: 'library' },
      { id: 'hit_1', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', zone: 'library' },
    ]);
    (game.state as any).zones = {
      [p1]: {
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        hand: [],
        handCount: 0,
        libraryCount: 2,
      },
    };
    (game.state as any).stack = [
      {
        id: 'spell_1',
        type: 'spell',
        controller: p1,
        card: { id: 'cast_1', name: 'Opt', type_line: 'Instant', oracle_text: 'Scry 1. Draw a card.', owner: p1, zone: 'stack' },
      },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1 as any,
      description: 'Neera, Wild Mage: Put Opt on the bottom and reveal until a nonland?',
      mandatory: false,
      sourceName: 'Neera, Wild Mage',
      options: [
        { id: 'yes', label: 'Use ability' },
        { id: 'no', label: 'Decline' },
      ],
      minSelections: 1,
      maxSelections: 1,
      spellBottomRevealUntilNonlandChoice: true,
      triggeringStackItemId: 'spell_1',
      triggeringSpellCard: { id: 'cast_1', name: 'Opt', type_line: 'Instant', oracle_text: 'Scry 1. Draw a card.', owner: p1 },
      revealFromLibraryPlayerId: p1,
      revealSourcePermanentId: 'neera_perm',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const firstStep = queue.steps.find((s: any) => s.type === 'option_choice');
    expect(firstStep).toBeDefined();

    await handlers['submitResolutionResponse']({ gameId, stepId: String((firstStep as any).id), selections: 'yes' });

    expect(((game.state as any).stack || []).some((item: any) => item.id === 'spell_1')).toBe(false);
    expect(((game as any).libraries.get(p1) || []).some((card: any) => card.id === 'cast_1')).toBe(true);

    const queueAfterFirst = ResolutionQueueManager.getQueue(gameId);
    const secondStep = queueAfterFirst.steps.find((s: any) => (s as any).castRevealedFromLibraryChoice === true);
    expect(secondStep).toBeDefined();

    await handlers['submitResolutionResponse']({ gameId, stepId: String((secondStep as any).id), selections: 'cast' });

    const stackNames = ((game.state as any).stack || []).map((item: any) => item.card?.name);
    expect(stackNames).toContain('Lightning Bolt');

    const libraryIds = new Set(((game as any).libraries.get(p1) || []).map((card: any) => card.id));
    expect(libraryIds.has('land_1')).toBe(true);
    expect(libraryIds.has('cast_1')).toBe(true);
  });
});
