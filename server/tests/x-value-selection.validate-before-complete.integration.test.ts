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

describe('X_VALUE_SELECTION validate-before-complete (integration)', () => {
  const gameId = 'test_x_value_selection_validate_before_complete';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('does not consume the step on invalid X selection (Blight X stage)', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).zones = { [p1]: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 } };

    // Ensure we have a valid creature to pay Blight onto.
    (game.state as any).battlefield = [
      {
        id: 'cre_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: { id: 'c1', name: 'Test Creature', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      },
    ];

    const activationId = 'act_1';
    (game.state as any).pendingBlightAbilityActivations = {
      [activationId]: {
        permanentId: 'src_1',
        cardName: 'Test Blight Engine',
      },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.X_VALUE_SELECTION,
      playerId: p1 as any,
      description: 'Choose X',
      mandatory: false,
      minValue: 0,
      maxValue: 20,
      keywordBlight: true,
      keywordBlightStage: 'ability_activation_cost_choose_x',
      keywordBlightController: p1,
      keywordBlightActivationId: activationId,
      keywordBlightSourceName: 'Test Blight Engine',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'x_value_selection');
    expect(step).toBeDefined();

    const stepId = String((step as any).id);

    // Invalid selection format
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: { xValue: 'nope' } });
    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INVALID_SELECTION');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    // Now submit a valid X
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: 2 });

    const queueAfterOk = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterOk.steps.some((s: any) => String(s.id) === stepId)).toBe(false);

    // It should enqueue a TARGET_SELECTION step for blight payment.
    expect(queueAfterOk.steps.some((s: any) => s.type === 'target_selection')).toBe(true);
  });
});
