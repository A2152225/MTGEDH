import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => undefined }),
    emit: (_event: string, _payload: any) => undefined,
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
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

describe('bounce land choice replay persistence', () => {
  const gameId = 'test_bounce_land_choice_replay';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('persists and replays the chosen returned permanent plus originating stack item removal', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      { id: 'bounce_land', controller: p1, owner: p1, tapped: false, card: { id: 'bounce_land', name: 'Simic Growth Chamber', type_line: 'Land' } },
      { id: 'forest_1', controller: p1, owner: p1, tapped: false, card: { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest' } },
    ];
    (game.state as any).stack = [
      { id: 'stack_bounce_1', type: 'triggered_ability', sourceName: 'Simic Growth Chamber', description: 'Return a land you control to its owner\'s hand.' },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE,
      playerId: p1 as any,
      description: 'Return a land to hand',
      mandatory: true,
      returnControlledPermanentChoice: true,
      returnControlledPermanentSourceName: 'Simic Growth Chamber',
      returnControlledPermanentDestination: 'hand',
      stackItemId: 'stack_bounce_1',
      returnControlledPermanentOptions: [
        { permanentId: 'forest_1', cardName: 'Forest' },
      ],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((entry: any) => entry.type === ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE);
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({ gameId, stepId: String((step as any).id), selections: 'forest_1' });

    const persisted = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'bounceLandChoice') as any;
    expect(persisted).toBeDefined();
    expect(persisted.payload?.playerId).toBe(p1);
    expect(persisted.payload?.returnedLandId).toBe('forest_1');
    expect(persisted.payload?.stackItemId).toBe('stack_bounce_1');
    expect(persisted.payload?.destination).toBe('hand');

    const replayGame = createInitialGameState('test_bounce_land_choice_replay_rehydrated');
    (replayGame.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (replayGame.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };
    (replayGame.state as any).battlefield = [
      { id: 'bounce_land', controller: p1, owner: p1, tapped: false, card: { id: 'bounce_land', name: 'Simic Growth Chamber', type_line: 'Land' } },
      { id: 'forest_1', controller: p1, owner: p1, tapped: false, card: { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest' } },
    ];
    (replayGame.state as any).stack = [
      { id: 'stack_bounce_1', type: 'triggered_ability', sourceName: 'Simic Growth Chamber', description: 'Return a land you control to its owner\'s hand.' },
    ];

    replayGame.applyEvent({ type: 'bounceLandChoice', ...(persisted.payload || {}) } as any);

    expect(((replayGame.state as any).battlefield || []).map((perm: any) => perm.id)).toEqual(['bounce_land']);
    expect(((replayGame.state as any).zones[p1].hand || []).map((card: any) => card.id)).toEqual(['forest_1']);
    expect((replayGame.state as any).stack || []).toHaveLength(0);
  });
});