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

describe('trigger order replay persistence', () => {
  const gameId = 'test_trigger_order_replay_live';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.removeQueue('test_trigger_order_replay_apply');
    games.delete(gameId as any);
  });

  it('persists and replays the chosen in-place trigger order', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).pendingTriggerOrdering = { [p1]: true };
    (game.state as any).stack = [
      { id: 'other_trigger', triggerId: 'other_trigger', sourceName: 'Other Trigger' },
      { id: 'trigger_a', triggerId: 'trigger_a', sourceName: 'Trigger A' },
      { id: 'trigger_b', triggerId: 'trigger_b', sourceName: 'Trigger B' },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TRIGGER_ORDER,
      playerId: p1 as any,
      description: 'Order your triggers',
      mandatory: true,
      triggers: [
        { id: 'trigger_a', sourceName: 'Trigger A', effect: 'A' },
        { id: 'trigger_b', sourceName: 'Trigger B', effect: 'B' },
      ],
      requireAll: true,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TRIGGER_ORDER);
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({ gameId, stepId: String((step as any).id), selections: ['trigger_b', 'trigger_a'] });

    expect(((game.state as any).stack || []).map((item: any) => item.id)).toEqual(['other_trigger', 'trigger_a', 'trigger_b']);

    const persisted = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'triggerOrderResponse') as any;
    expect(persisted).toBeDefined();
    expect(persisted.payload?.stepId).toBe(String((step as any).id));
    expect(persisted.payload?.orderedTriggerIds).toEqual(['trigger_b', 'trigger_a']);

    const replayGame = createInitialGameState('test_trigger_order_replay_apply');
    (replayGame.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (replayGame.state as any).pendingTriggerOrdering = { [p1]: true };
    (replayGame.state as any).stack = [
      { id: 'other_trigger', triggerId: 'other_trigger', sourceName: 'Other Trigger' },
      { id: 'trigger_a', triggerId: 'trigger_a', sourceName: 'Trigger A' },
      { id: 'trigger_b', triggerId: 'trigger_b', sourceName: 'Trigger B' },
    ];

    ResolutionQueueManager.addStep('test_trigger_order_replay_apply', {
      id: String((step as any).id),
      type: ResolutionStepType.TRIGGER_ORDER,
      playerId: p1 as any,
      description: 'Order your triggers',
      mandatory: true,
      triggers: [
        { id: 'trigger_a', sourceName: 'Trigger A', effect: 'A' },
        { id: 'trigger_b', sourceName: 'Trigger B', effect: 'B' },
      ],
      requireAll: true,
    } as any);

    replayGame.applyEvent({ type: 'triggerOrderResponse', ...(persisted.payload || {}) } as any);

    expect(((replayGame.state as any).stack || []).map((item: any) => item.id)).toEqual(['other_trigger', 'trigger_a', 'trigger_b']);
    expect((replayGame.state as any).pendingTriggerOrdering?.[p1]).toBeUndefined();
    expect(ResolutionQueueManager.getQueue('test_trigger_order_replay_apply').steps).toHaveLength(0);
  });
});