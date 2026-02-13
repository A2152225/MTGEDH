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

describe('EXPLORE_DECISION validate-before-complete (integration)', () => {
  const gameId = 'test_explore_decision_validate_before_complete';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('does not consume the step when permanentId does not match, then consumes once valid', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    const exploredCard = {
      id: 'lib1',
      name: 'Nonland Spell',
      type_line: 'Sorcery',
    };

    // Make explore handler deterministic for the test.
    (game as any).peekTopN = () => [exploredCard];
    (game as any).applyEvent = (_e: any) => {
      // no-op
    };

    const permanentId = 'perm_explore';
    const otherPermanentId = 'perm_other';
    (game.state as any).battlefield = [
      {
        id: permanentId,
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: { id: permanentId, name: 'Explorer', type_line: 'Creature', power: '2', toughness: '2' },
      },
      {
        id: otherPermanentId,
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: { id: otherPermanentId, name: 'Other', type_line: 'Creature', power: '1', toughness: '1' },
      },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.EXPLORE_DECISION,
      playerId: p1 as any,
      description: 'Explorer explores',
      mandatory: true,
      sourceId: permanentId,
      sourceName: 'Explorer',
      permanentId,
      permanentName: 'Explorer',
      revealedCard: exploredCard,
      isLand: false,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'explore_decision');
    expect(step).toBeDefined();

    const stepId = String((step as any).id);

    // Invalid: tries to apply explore decision to a different permanent
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: { permanentId: otherPermanentId, toGraveyard: true } });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INVALID_SELECTION');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    // Valid: match permanentId (or omit it) and provide a boolean decision
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: { permanentId, toGraveyard: true } });

    const queueAfterOk = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterOk.steps.some((s: any) => String(s.id) === stepId)).toBe(false);

    const chat = emitted.find(e => e.event === 'chat' && typeof e.payload?.message === 'string' && e.payload.message.includes('puts a +1/+1 counter'));
    expect(chat).toBeDefined();
  });
});
