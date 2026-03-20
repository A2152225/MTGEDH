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
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (event: string, fn: Function) => {
      handlers[event] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('return controlled permanent choice (integration)', () => {
  const gameId = 'test_return_controlled_permanent_choice';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('uses generic return-controlled-permanent payload fields to move the chosen permanent to hand', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [p1]: {
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        hand: [],
        handCount: 0,
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      { id: 'land_1', controller: p1, owner: p1, tapped: false, card: { id: 'land_1', name: 'Forest', type_line: 'Basic Land — Forest' } },
      { id: 'land_2', controller: p1, owner: p1, tapped: true, card: { id: 'land_2', name: 'Utility Land', type_line: 'Land' } },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE,
      playerId: p1 as any,
      description: 'Source: Return a permanent you control to hand',
      mandatory: true,
      sourceName: 'Source',
      returnControlledPermanentChoice: true,
      returnControlledPermanentSourceName: 'Source',
      returnControlledPermanentDestination: 'hand',
      returnControlledPermanentOptions: [
        { permanentId: 'land_1', cardName: 'Forest' },
        { permanentId: 'land_2', cardName: 'Utility Land' },
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

    await handlers['submitResolutionResponse']({ gameId, stepId: String((step as any).id), selections: 'land_2' });

    expect(((game.state as any).battlefield || []).map((perm: any) => perm.id)).toEqual(['land_1']);
    expect(((game.state as any).zones[p1].hand || []).map((card: any) => card.id)).toEqual(['land_2']);
    const chat = emitted.find((entry) => entry.event === 'chat');
    expect(chat?.payload?.message).toContain('Utility Land');
    expect(chat?.payload?.message).toContain('to hand');
  });
});
