import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

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

describe('proliferate live tracking', () => {
  const gameId = 'test_proliferate_tracking_integration';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('tracks creature counter placement when proliferate resolves live', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'perm_1',
        controller: p1,
        owner: p1,
        counters: { '+1/+1': 2, charge: 1 },
        card: { id: 'perm_card', name: 'Contagion Target', type_line: 'Artifact Creature' },
      },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.PROLIFERATE,
      playerId: p1 as any,
      description: 'Proliferate now',
      mandatory: false,
      proliferateId: 'prolif_1',
      availableTargets: [{ id: 'perm_1', name: 'Contagion Target', counters: { '+1/+1': 2, charge: 1 } }],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((entry: any) => entry.type === ResolutionStepType.PROLIFERATE);
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({ gameId, stepId: String((step as any).id), selections: ['perm_1'] });

    expect((game.state as any).battlefield[0].counters).toEqual({ '+1/+1': 3, charge: 2 });
    expect((game.state as any).putCounterOnCreatureThisTurn?.[p1]).toBe(true);
    expect((game.state as any).countersPutThisTurnByPermanentId?.perm_1).toBe(1);
    expect((game.state as any).plusOneCountersPutThisTurnByPermanentId?.perm_1).toBe(1);
  });
});