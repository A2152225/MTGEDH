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

describe('More validate-before-complete steps (integration)', () => {
  const gameId = 'test_more_steps_validate_before_complete';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('HAND_TO_BOTTOM does not consume on invalid selection, then consumes once valid', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    (game.state as any).zones = {
      [p1]: {
        hand: [
          { id: 'c1', name: 'Card 1', zone: 'hand' },
          { id: 'c2', name: 'Card 2', zone: 'hand' },
        ],
        handCount: 2,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };

    (game.state as any).mulliganState = {
      [p1]: {
        hasKeptHand: false,
        mulligansTaken: 0,
        pendingBottomCount: 1,
        pendingBottomStepId: null,
      },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.HAND_TO_BOTTOM,
      playerId: p1 as any,
      description: 'Put 1 card on bottom',
      mandatory: true,
      cardsToBottom: 1,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'hand_to_bottom');
    expect(step).toBeDefined();
    const stepId = String((step as any).id);

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: ['not_in_hand'] });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('CARD_NOT_IN_HAND');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: ['c1'] });

    const queueAfterOk = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterOk.steps.some((s: any) => String(s.id) === stepId)).toBe(false);
  });

  it('MANA_COLOR_SELECTION does not consume on invalid selection, then consumes once valid', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_COLOR_SELECTION,
      playerId: p1 as any,
      description: 'Choose a color (restricted to U)',
      mandatory: true,
      selectionKind: 'any_color',
      allowedColors: ['U'],
      amount: 1,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'mana_color_selection');
    expect(step).toBeDefined();
    const stepId = String((step as any).id);

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: 'purple' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INVALID_COLOR');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: 'blue' });

    const queueAfterOk = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterOk.steps.some((s: any) => String(s.id) === stepId)).toBe(false);
  });

  it('DISCARD_SELECTION does not consume on invalid selection, then consumes once valid', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    (game.state as any).zones = {
      [p1]: {
        hand: [
          { id: 'd1', name: 'Discard Me', zone: 'hand' },
          { id: 'd2', name: 'Keep Me', zone: 'hand' },
        ],
        handCount: 2,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: p1 as any,
      description: 'Choose a card to discard',
      mandatory: true,
      discardCount: 1,
      destination: 'graveyard',
      hand: [
        { id: 'd1', name: 'Discard Me', zone: 'hand' },
        { id: 'd2', name: 'Keep Me', zone: 'hand' },
      ],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'discard_selection');
    expect(step).toBeDefined();
    const stepId = String((step as any).id);

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: ['not_in_hand'] });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('CARD_NOT_IN_HAND');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: ['d2'] });

    const queueAfterOk = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterOk.steps.some((s: any) => String(s.id) === stepId)).toBe(false);
  });

  it('GRAVEYARD_SELECTION does not consume on invalid selection, then consumes once valid', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [
          { id: 'g1', name: 'Grave Card', type_line: 'Creature', power: '1', toughness: '1', zone: 'graveyard' },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.GRAVEYARD_SELECTION,
      playerId: p1 as any,
      description: 'Select a card from graveyard',
      mandatory: true,
      targetPlayerId: p1,
      destination: 'hand',
      minTargets: 1,
      maxTargets: 1,
      validTargets: [{ id: 'g1', name: 'Grave Card' }],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'graveyard_selection');
    expect(step).toBeDefined();
    const stepId = String((step as any).id);

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: ['not_a_valid_target'] });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INVALID_TARGET');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: ['g1'] });

    const queueAfterOk = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterOk.steps.some((s: any) => String(s.id) === stepId)).toBe(false);
  });
});
