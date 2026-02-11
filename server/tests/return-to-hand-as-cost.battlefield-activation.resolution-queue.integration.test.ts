import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
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

describe("Return-to-hand-as-activation-cost via Resolution Queue (integration)", () => {
  const gameId = 'test_return_to_hand_activation_cost_resolution_queue';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it("enqueues TARGET_SELECTION and resumes activation after returning a creature you control to its owner's hand", async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    // Deterministic priority baseline.
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).battlefield = [
      {
        id: 'src_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Test Engine',
          type_line: 'Artifact',
          oracle_text: "Return a creature you control to its owner's hand: Draw a card.",
          image_uris: { small: 'https://example.com/engine.jpg' },
        },
      },
      {
        id: 'c_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Test Creature',
          type_line: 'Creature — Bear',
          oracle_text: '',
          image_uris: { small: 'https://example.com/bear.jpg' },
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        graveyard: [],
        exile: [],
        handCount: 0,
        graveyardCount: 0,
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    expect(typeof handlers['activateBattlefieldAbility']).toBe('function');
    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);

    const step = queue.steps[0] as any;
    expect(step.type).toBe('target_selection');
    expect(step.playerId).toBe(p1);
    expect(step.returnToHandAbilityAsCost).toBe(true);
    expect(step.minTargets).toBe(1);
    expect(step.maxTargets).toBe(1);
    expect(Array.isArray(step.validTargets)).toBe(true);
    expect(step.validTargets.some((t: any) => t && String(t.id) === 'c_1')).toBe(true);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: ['c_1'],
    });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.some((p: any) => p && p.id === 'c_1')).toBe(false);

    const zones = (game.state as any).zones?.[p1];
    expect(zones).toBeDefined();
    expect(Array.isArray(zones.hand)).toBe(true);
    expect((zones.hand as any[]).some((c: any) => c && String(c.name || '').includes('Test Creature'))).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack.length).toBe(1);
    expect(String(stack[0].type)).toBe('ability');
    expect(String(stack[0].source)).toBe('src_1');
    expect(String(stack[0].description || '').toLowerCase()).toContain('draw a card');

    expect(emitted.some((e) => e.room === gameId && e.event === 'stackUpdate')).toBe(true);
  });
});
