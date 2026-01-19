import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { emitPendingDamageTriggers } from '../src/socket/game-actions.js';

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

function createMockIo(
  emitted: Array<{ room?: string; event: string; payload: any; from?: string }>,
  sockets: any[] = []
) {
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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any; from?: string }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload, from: playerId });
    },
  } as any;
  return { socket, handlers };
}

describe('Damage triggers via Resolution Queue (integration)', () => {
  const gameId = 'test_damage_triggers_resolution_queue';

  beforeAll(async () => {
    await initDb();

    // Ensure Resolution Queue steps enter/exit "resolution mode" (priority = null)
    // like the real server does in registerSocketHandlers().
    initializePriorityResolutionHandler(createNoopIo() as any);
    // Wait a tick for the dynamic import inside initializePriorityResolutionHandler.
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('enqueues a TARGET_SELECTION step and applies damage to a permanent target', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';

    // Establish a deterministic priority baseline.
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    (game.state as any).battlefield = [
      {
        id: 'src_1',
        controller: p1,
        card: {
          name: 'Brash Taunter',
          type_line: 'Creature — Goblin',
          image_uris: { small: 'https://example.com/taunter.jpg' },
        },
      },
      {
        id: 'perm_1',
        controller: p2,
        damageMarked: 0,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          image_uris: { small: 'https://example.com/bears.jpg' },
        },
      },
    ];

    (game.state as any).pendingDamageTriggers = {
      trig_1: {
        sourceId: 'src_1',
        sourceName: 'Brash Taunter',
        controller: p1,
        damageAmount: 5,
        triggerType: 'dealt_damage',
        targetType: 'any',
        targetRestriction: 'any target',
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    // Convert pendingDamageTriggers -> Resolution Queue step
    const enqueued = emitPendingDamageTriggers(io as any, game as any, gameId);
    expect(enqueued).toBe(1);

    // When a resolution step is enqueued, priority should be cleared.
    expect((game.state as any).priority).toBe(null);

    // Client should be prompted via Resolution Queue, not via legacy event
    const promptEvt = emitted.find(e => e.event === 'resolutionStepPrompt');
    expect(promptEvt).toBeDefined();
    expect(promptEvt!.payload.gameId).toBe(gameId);
    expect(promptEvt!.payload.step?.type).toBe('target_selection');
    expect(emitted.some(e => e.event === 'damageTriggerTargetRequest')).toBe(false);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);
    const step = queue.steps[0] as any;
    expect(step.playerId).toBe(p1);
    expect(step.damageReceivedTrigger).toBe(true);

    // Pick a permanent target
    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['perm_1'] });

    // After the last step completes, priority should be restored to turn player.
    expect((game.state as any).priority).toBe(p1);

    const targetPerm = (game.state as any).battlefield.find((p: any) => p.id === 'perm_1');
    expect(targetPerm.damageMarked).toBe(5);

    // Players should be unchanged for permanent-target case
    expect((game.state as any).life[p1]).toBe(40);
    expect((game.state as any).life[p2]).toBe(40);

    const chatEvt = emitted.find(e => e.room === gameId && e.event === 'chat');
    expect(chatEvt).toBeDefined();
    expect(String(chatEvt!.payload.message || '')).toContain('Brash Taunter');
  });

  it('applies damage to a player target (life decreases)', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';

    // Establish a deterministic priority baseline.
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    (game.state as any).battlefield = [
      {
        id: 'src_1',
        controller: p1,
        card: {
          name: 'Brash Taunter',
          type_line: 'Creature — Goblin',
          image_uris: { small: 'https://example.com/taunter.jpg' },
        },
      },
    ];

    (game.state as any).pendingDamageTriggers = {
      trig_1: {
        sourceId: 'src_1',
        sourceName: 'Brash Taunter',
        controller: p1,
        damageAmount: 3,
        triggerType: 'dealt_damage',
        targetType: 'any',
        targetRestriction: 'any target',
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const enqueued = emitPendingDamageTriggers(io as any, game as any, gameId);
    expect(enqueued).toBe(1);

    expect((game.state as any).priority).toBe(null);

    const step = ResolutionQueueManager.getQueue(gameId).steps[0] as any;

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: [p2] });

    expect((game.state as any).priority).toBe(p1);

    expect((game.state as any).life[p2]).toBe(37);
  });

  it('chains damage triggers: damaging a trigger-permanent enqueues a follow-up step', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';

    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    // Two Brash Taunters: resolving P1's trigger deals damage to P2's Taunter,
    // which should create a new damage trigger for P2.
    (game.state as any).battlefield = [
      {
        id: 'taunter_1',
        controller: p1,
        damageMarked: 0,
        card: {
          name: 'Brash Taunter',
          type_line: 'Creature — Goblin',
          image_uris: { small: 'https://example.com/taunter1.jpg' },
        },
      },
      {
        id: 'taunter_2',
        controller: p2,
        damageMarked: 0,
        card: {
          name: 'Brash Taunter',
          type_line: 'Creature — Goblin',
          image_uris: { small: 'https://example.com/taunter2.jpg' },
        },
      },
    ];

    (game.state as any).pendingDamageTriggers = {
      trig_1: {
        sourceId: 'taunter_1',
        sourceName: 'Brash Taunter',
        controller: p1,
        damageAmount: 5,
        triggerType: 'dealt_damage',
        targetType: 'any',
        targetRestriction: 'any target',
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any; from?: string }> = [];
    const { socket: s1, handlers: h1 } = createMockSocket(p1, emitted);
    const { socket: s2, handlers: h2 } = createMockSocket(p2, emitted);
    s1.rooms.add(gameId);
    s2.rooms.add(gameId);

    const io = createMockIo(emitted, [s1, s2]);
    registerResolutionHandlers(io as any, s1 as any);
    registerResolutionHandlers(io as any, s2 as any);

    const enqueued = emitPendingDamageTriggers(io as any, game as any, gameId);
    expect(enqueued).toBe(1);
    expect((game.state as any).priority).toBe(null);

    const step1 = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(step1.playerId).toBe(p1);

    // P1 targets the other Brash Taunter
    expect(typeof h1['submitResolutionResponse']).toBe('function');
    await h1['submitResolutionResponse']({ gameId, stepId: step1.id, selections: ['taunter_2'] });

    // Follow-up trigger should be enqueued for P2, keeping us in resolution mode.
    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.length).toBe(1);
    const step2 = queueAfter.steps[0] as any;
    expect(step2.playerId).toBe(p2);
    expect(step2.damageReceivedTrigger).toBe(true);
    expect((game.state as any).priority).toBe(null);

    // P2 points their trigger back at P1 (player target)
    expect(typeof h2['submitResolutionResponse']).toBe('function');
    await h2['submitResolutionResponse']({ gameId, stepId: step2.id, selections: [p1] });

    // After the chain completes, priority should be restored.
    expect((game.state as any).priority).toBe(p1);
    expect((game.state as any).life[p1]).toBe(35);

    // Sanity: at least two resolution prompts occurred (one per step)
    const promptCount = emitted.filter(e => e.event === 'resolutionStepPrompt').length;
    expect(promptCount).toBeGreaterThanOrEqual(2);
  });

  it('applies each_opponent damage immediately (no resolution step)', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';
    const p3 = 'p3';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 30 },
      { id: p2, name: 'P2', spectator: false, life: 30 },
      { id: p3, name: 'P3', spectator: false, life: 30 },
    ];
    (game.state as any).startingLife = 30;
    // Intentionally omit one opponent life entry to ensure we default to startingLife, not hard-coded 40.
    (game.state as any).life = { [p1]: 30, [p3]: 30 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).battlefield = [
      {
        id: 'src_1',
        controller: p1,
        card: {
          name: 'Terror of the Peaks',
          type_line: 'Creature — Dragon',
          image_uris: { small: 'https://example.com/dragon.jpg' },
        },
      },
    ];

    (game.state as any).pendingDamageTriggers = {
      trig_1: {
        sourceId: 'src_1',
        sourceName: 'Terror of the Peaks',
        controller: p1,
        damageAmount: 2,
        triggerType: 'dealt_damage',
        targetType: 'each_opponent',
        targetRestriction: 'each opponent',
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    const processed = emitPendingDamageTriggers(io as any, game as any, gameId);
    expect(processed).toBe(1);

    // Immediate life loss for opponents only
    expect((game.state as any).life[p1]).toBe(30);
    expect((game.state as any).life[p2]).toBe(28);
    expect((game.state as any).life[p3]).toBe(28);

    // No Resolution Queue step or client prompt
    expect(ResolutionQueueManager.getQueue(gameId)?.steps?.length || 0).toBe(0);
    expect(emitted.some(e => e.event === 'resolutionStepPrompt')).toBe(false);
    expect(emitted.some(e => e.event === 'damageTriggerTargetRequest')).toBe(false);

    // Pending triggers are fully cleared
    expect((game.state as any).pendingDamageTriggers).toBeUndefined();

    const chatEvt = emitted.find(e => e.room === gameId && e.event === 'chat');
    expect(chatEvt).toBeDefined();
    expect(String(chatEvt!.payload.message || '')).toContain('each opponent');
  });
});
