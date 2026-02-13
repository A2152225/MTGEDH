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

describe('BATCH_EXPLORE_DECISION validate-before-complete (integration)', () => {
  const gameId = 'test_batch_explore_decision_validate_before_complete';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('does not consume the step on missing decisions, then consumes once valid', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    const exploredCard = { id: 'lib1', name: 'Nonland Spell', type_line: 'Sorcery' };
    (game as any).peekTopN = () => [exploredCard];
    (game as any).applyEvent = (_e: any) => {
      // no-op
    };

    const permanentA = 'permA';
    const permanentB = 'permB';
    (game.state as any).battlefield = [
      {
        id: permanentA,
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: { id: permanentA, name: 'Explorer A', type_line: 'Creature', power: '2', toughness: '2' },
      },
      {
        id: permanentB,
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: { id: permanentB, name: 'Explorer B', type_line: 'Creature', power: '2', toughness: '2' },
      },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.BATCH_EXPLORE_DECISION,
      playerId: p1 as any,
      description: 'Resolve explores',
      mandatory: true,
      sourceName: 'Explore',
      explores: [
        { permanentId: permanentA, permanentName: 'Explorer A', revealedCard: exploredCard, isLand: false },
        { permanentId: permanentB, permanentName: 'Explorer B', revealedCard: exploredCard, isLand: false },
      ],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'batch_explore_decision');
    expect(step).toBeDefined();

    const stepId = String((step as any).id);

    // Invalid: missing decisions array
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: {} });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INVALID_SELECTION');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    // Valid: decisions for both permanents
    await handlers['submitResolutionResponse']({
      gameId,
      stepId,
      selections: {
        decisions: [
          { permanentId: permanentA, toGraveyard: true },
          { permanentId: permanentB, toGraveyard: false },
        ],
      },
    });

    const queueAfterOk = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterOk.steps.some((s: any) => String(s.id) === stepId)).toBe(false);

    const chat = emitted.find(e => e.event === 'chat' && typeof e.payload?.message === 'string' && e.payload.message.includes('resolves explores'));
    expect(chat).toBeDefined();
  });
});
