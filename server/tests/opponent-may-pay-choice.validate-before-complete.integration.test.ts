import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { registerOpponentMayPayHandlers } from '../src/socket/opponent-may-pay.js';
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

describe('opponentMayPayChoice validate-before-complete (integration)', () => {
  const gameId = 'test_opponent_may_pay_choice_validate_before_complete';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('does not consume the step on insufficient mana when selecting pay', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    // Defensive: some test harnesses may use a minimal game adapter.
    if (typeof (game as any).applyEvent !== 'function') {
      (game as any).applyEvent = () => {};
    }

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1 as any,
      description: 'Rhystic Study: Pay {1}?',
      mandatory: true,
      minSelections: 1,
      maxSelections: 1,
      options: [
        { id: 'pay', label: 'Pay {1}' },
        { id: 'decline', label: 'Decline' },
      ],

      opponentMayPayChoice: true,
      promptId: 'prompt_1',
      sourceName: 'Rhystic Study',
      sourceController: 'p2',
      decidingPlayer: p1,
      manaCost: '{1}',
      declineEffect: 'Draw a card',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'option_choice' && (s as any).opponentMayPayChoice === true);
    expect(step).toBeDefined();

    const stepId = String((step as any).id);

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: 'pay' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INSUFFICIENT_MANA');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    // Add mana and retry; should now complete.
    (game.state as any).manaPool[p1].colorless = 1;
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: 'pay' });

    const queueAfterPay = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterPay.steps.some((s: any) => String(s.id) === stepId)).toBe(false);
  });

  it('queues migrated opponent-pay prompts through the shared optional-payment path', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    if (typeof (game as any).applyEvent !== 'function') {
      (game as any).applyEvent = () => {};
    }

    const p1 = 'p1';
    const judgeId = 'judge';
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: judgeId, name: 'Judge', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [judgeId]: 40 };
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const playerSocketState = createMockSocket(p1, emitted);
    playerSocketState.socket.rooms.add(gameId);
    const judgeSocketState = createMockSocket(judgeId, emitted);
    judgeSocketState.socket.rooms.add(gameId);
    (judgeSocketState.socket.data as any).role = 'judge';
    (judgeSocketState.socket.data as any).gameId = gameId;

    const io = createMockIo(emitted, [playerSocketState.socket, judgeSocketState.socket]);
    registerResolutionHandlers(io as any, playerSocketState.socket as any);
    registerOpponentMayPayHandlers(io as any, judgeSocketState.socket as any);

    await judgeSocketState.handlers['emitOpponentMayPayPrompt']({
      gameId,
      promptId: 'prompt_2',
      sourceName: 'Rhystic Study',
      sourceController: 'p2',
      decidingPlayer: p1,
      manaCost: '{1}',
      declineEffect: 'Draw a card',
      triggerText: 'Rhystic Study triggers: Pay {1} or its controller draws a card.',
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => (s as any).opponentMayPayChoice === true);
    expect(step).toBeDefined();
    expect((step as any).optionalPaymentPrompt).toBe(true);
    expect((step as any).availableMana).toEqual((game.state as any).manaPool[p1]);

    const stepId = String((step as any).id);
    await playerSocketState.handlers['submitResolutionResponse']({ gameId, stepId, selections: 'pay' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INSUFFICIENT_MANA');
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    (game.state as any).manaPool[p1].colorless = 1;
    await playerSocketState.handlers['submitResolutionResponse']({ gameId, stepId, selections: 'pay' });

    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => String(s.id) === stepId)).toBe(false);
  });
});
