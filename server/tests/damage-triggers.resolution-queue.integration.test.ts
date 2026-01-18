import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { emitPendingDamageTriggers } from '../src/socket/game-actions.js';

function createMockIo(
  emitted: Array<{ room?: string; event: string; payload: any }>,
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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('Damage triggers via Resolution Queue (integration)', () => {
  const gameId = 'test_damage_triggers_resolution_queue';

  beforeAll(async () => {
    await initDb();
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
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    // Convert pendingDamageTriggers -> Resolution Queue step
    const enqueued = emitPendingDamageTriggers(io as any, game as any, gameId);
    expect(enqueued).toBe(1);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);
    const step = queue.steps[0] as any;
    expect(step.playerId).toBe(p1);
    expect(step.damageReceivedTrigger).toBe(true);

    // Pick a permanent target
    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['perm_1'] });

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
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const enqueued = emitPendingDamageTriggers(io as any, game as any, gameId);
    expect(enqueued).toBe(1);

    const step = ResolutionQueueManager.getQueue(gameId).steps[0] as any;

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: [p2] });

    expect((game.state as any).life[p2]).toBe(37);
  });
});
