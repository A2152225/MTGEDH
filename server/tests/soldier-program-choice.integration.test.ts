import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
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

describe('SOLDIER Military Program choice persistence (integration)', () => {
  const gameId = 'test_soldier_program_choice_persistence';

  async function resetGame(gameId: string) {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  it('persists token creation, queued Soldier selection, and final chosen counters', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'commander_1',
        controller: p1,
        owner: p1,
        counters: {},
        card: { id: 'commander_card', name: 'Test Commander', type_line: 'Legendary Creature — Human Knight' },
      },
      {
        id: 'soldier_1',
        controller: p1,
        owner: p1,
        counters: {},
        basePower: 1,
        baseToughness: 1,
        card: { id: 'soldier_card_1', name: 'Soldier One', type_line: 'Creature — Soldier' },
      },
      {
        id: 'soldier_2',
        controller: p1,
        owner: p1,
        counters: {},
        basePower: 1,
        baseToughness: 1,
        card: { id: 'soldier_card_2', name: 'Soldier Two', type_line: 'Creature — Soldier' },
      },
      {
        id: 'soldier_3',
        controller: p1,
        owner: p1,
        counters: {},
        basePower: 1,
        baseToughness: 1,
        card: { id: 'soldier_card_3', name: 'Soldier Three', type_line: 'Creature — Soldier' },
      },
    ];

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MODAL_CHOICE,
      playerId: p1,
      description: 'SOLDIER Military Program: Choose one or both',
      mandatory: true,
      sourceName: 'SOLDIER Military Program',
      options: [
        { id: 'create_token', label: 'Create a 1/1 white Soldier creature token' },
        { id: 'add_counters', label: 'Put a +1/+1 counter on each of up to two Soldiers' },
        { id: 'both', label: 'Choose both' },
      ],
      minSelections: 1,
      maxSelections: 2,
      triggerData: {
        triggerType: 'begin_combat',
        sourceName: 'SOLDIER Military Program',
        sourceId: 'soldier_program_1',
        isSoldierProgram: true,
        canChooseBoth: true,
      },
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: String((step as any).id), selections: ['both'] });

    const battlefield = (game.state as any).battlefield || [];
    const token = battlefield.find((perm: any) => perm && perm.isToken === true && String(perm.card?.name || '') === 'Soldier');
    expect(token).toBeDefined();

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((queue.steps[0] as any).soldierProgramCounters).toBe(true);
    expect(((queue.steps[0] as any).validTargets || []).map((target: any) => String(target.id))).toContain(String(token?.id || ''));

    const createTokenEvent = [...getEvents(gameId)].reverse().find((event: any) =>
      event.type === 'executeEffect' && String(event.payload?.effectType || '') === 'createToken'
    ) as any;
    const promptEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'resolveTopOfStackPrompt') as any;
    expect(createTokenEvent?.payload?.controllerId).toBe(p1);
    expect(createTokenEvent?.payload?.tokenData?.id).toBe(String(token?.id || ''));
    expect(promptEvent?.payload?.sourceId).toBe('soldier_program_1');
    expect(promptEvent?.payload?.queuedResolutionStep?.soldierProgramCounters).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['soldier_1', 'soldier_2'],
    });

    const soldierOne = ((game.state as any).battlefield || []).find((perm: any) => perm.id === 'soldier_1');
    const soldierTwo = ((game.state as any).battlefield || []).find((perm: any) => perm.id === 'soldier_2');
    expect(soldierOne?.counters).toEqual({ '+1/+1': 1 });
    expect(soldierTwo?.counters).toEqual({ '+1/+1': 1 });

    const counterEvents = getEvents(gameId).filter((event: any) => event.type === 'counterTargetChosen') as any[];
    expect(counterEvents.map((event: any) => String(event.payload?.targetId || '')).sort()).toEqual(['soldier_1', 'soldier_2']);
  });
});