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
    rooms: { has: (_room: string) => true, add: (_room: string) => {}, delete: (_room: string) => {} } as any,
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('MORPH_TURN_FACE_UP validate-before-complete (integration)', () => {
  const gameId = 'test_morph_turn_face_up_validate_before_complete';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('does not consume the step when the permanent is not face-down, then consumes once valid', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    const permanentId = 'morph1';
    (game.state as any).battlefield = [
      {
        id: permanentId,
        controller: p1,
        owner: p1,
        tapped: false,
        isFaceDown: false, // invalid state for the step
        card: {
          id: 'fd_card',
          name: 'Face-down creature',
          type_line: 'Creature',
          power: '2',
          toughness: '2',
        },
      },
    ];

    const actualCard = {
      id: 'actual1',
      name: 'Test Morph Creature',
      type_line: 'Creature — Shapeshifter',
      power: '3',
      toughness: '3',
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MORPH_TURN_FACE_UP,
      playerId: p1 as any,
      description: 'Turn a creature face-up',
      mandatory: false,
      permanentId,
      morphCost: '{2}',
      actualCard,
      canAfford: true,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'morph_turn_face_up');
    expect(step).toBeDefined();

    const stepId = String((step as any).id);

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: [] });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INVALID_SELECTION');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    // Make the attempt valid by restoring face-down state
    const perm = ((game.state as any).battlefield as any[]).find((p: any) => String(p?.id) === permanentId);
    perm.isFaceDown = true;

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: [] });

    const queueAfterOk = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterOk.steps.some((s: any) => String(s.id) === stepId)).toBe(false);

    const chat = emitted.find(e => e.event === 'chat' && typeof e.payload?.message === 'string' && e.payload.message.includes('turned'));
    expect(chat).toBeDefined();

    const permAfter = ((game.state as any).battlefield as any[]).find((p: any) => String(p?.id) === permanentId);
    expect(permAfter?.isFaceDown).toBe(false);
    expect(permAfter?.card?.name).toBe('Test Morph Creature');
  });
});
