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

describe('ENTRAPMENT_MANEUVER validate-before-complete (integration)', () => {
  const gameId = 'test_entrapment_maneuver_validate_before_complete';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('does not consume the step on invalid creature selection, then consumes once valid', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1'; // target player
    const p2 = 'p2'; // caster

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const creatureId = 'atk1';
    (game.state as any).battlefield = [
      {
        id: creatureId,
        controller: p1,
        owner: p1,
        tapped: true,
        attacking: true,
        counters: {},
        card: {
          id: creatureId,
          name: 'Attacking Bear',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
        },
      },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.ENTRAPMENT_MANEUVER,
      playerId: p1 as any,
      description: 'You must sacrifice an attacking creature you control.',
      mandatory: true,
      sourceId: 'spell1',
      sourceName: 'Entrapment Maneuver',
      caster: p2,
      attackingCreatures: [
        {
          id: creatureId,
          name: 'Attacking Bear',
          power: '2',
          toughness: '2',
          typeLine: 'Creature — Bear',
        },
      ],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'entrapment_maneuver');
    expect(step).toBeDefined();

    const stepId = String((step as any).id);

    // Invalid selection should be rejected and not consume the step
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: 'not_a_real_creature' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INVALID_SELECTION');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    // Now submit a valid selection
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: creatureId });

    const queueAfterOk = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterOk.steps.some((s: any) => String(s.id) === stepId)).toBe(false);

    const battlefieldAfter = (game.state as any).battlefield as any[];
    expect(battlefieldAfter.some(p => String(p?.id) === creatureId)).toBe(false);

    const soldierTokens = battlefieldAfter.filter(p => p?.isToken === true && p?.controller === p2 && p?.card?.name === 'Soldier');
    expect(soldierTokens.length).toBe(2);

    const chat = emitted.find(e => e.event === 'chat' && typeof e.payload?.message === 'string' && e.payload.message.includes('sacrificed'));
    expect(chat).toBeDefined();
  });
});
