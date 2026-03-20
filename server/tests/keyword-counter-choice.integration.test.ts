import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

describe('keyword counter choice (integration)', () => {
  const gameId = 'test_keyword_counter_choice';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('adds the chosen keyword counter and keyword text to the target permanent', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'beast_1',
        controller: p1,
        owner: p1,
        counters: {},
        grantedAbilities: [],
        card: {
          name: 'Beast',
          type_line: 'Token Creature — Beast',
          keywords: [],
        },
      },
    ];

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MODAL_CHOICE,
      playerId: p1,
      description: 'Choose a counter type to put on the Beast token',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'vigilance', label: 'Vigilance' },
        { id: 'reach', label: 'Reach' },
        { id: 'trample', label: 'Trample' },
      ],
      minSelections: 1,
      maxSelections: 1,
      keywordCounterChoiceData: {
        targetPermanentId: 'beast_1',
        targetName: 'Beast',
        allowedKeywords: ['vigilance', 'reach', 'trample'],
      },
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: 'reach' });

    const beast = ((game.state as any).battlefield || [])[0];
    expect(beast.counters.reach).toBe(1);
    expect(beast.card.keywords).toContain('Reach');
  });

  it('supports multiword keyword ids and extra fixed counters', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'creature_1',
        controller: p1,
        owner: p1,
        counters: {},
        card: {
          name: 'Target Creature',
          type_line: 'Creature — Test',
          keywords: [],
        },
      },
    ];

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MODAL_CHOICE,
      playerId: p1,
      description: 'Choose a counter type to put on the creature',
      mandatory: true,
      sourceName: 'Elspeth Resplendent',
      options: [
        { id: 'flying', label: 'Flying' },
        { id: 'first_strike', label: 'First strike' },
        { id: 'lifelink', label: 'Lifelink' },
        { id: 'vigilance', label: 'Vigilance' },
      ],
      minSelections: 1,
      maxSelections: 1,
      keywordCounterChoiceData: {
        targetPermanentId: 'creature_1',
        targetName: 'Target Creature',
        allowedKeywords: ['flying', 'first strike', 'lifelink', 'vigilance'],
        extraCounters: { '+1/+1': 1 },
        sourceName: 'Elspeth Resplendent',
      },
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: 'first_strike' });

    const creature = ((game.state as any).battlefield || [])[0];
    expect(creature.counters['+1/+1']).toBe(1);
    expect(creature.counters['first strike']).toBe(1);
    expect(creature.card.keywords).toContain('First Strike');
  });
});