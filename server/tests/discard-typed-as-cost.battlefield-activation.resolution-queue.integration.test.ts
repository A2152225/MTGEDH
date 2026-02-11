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

describe('Discard typed card as activation cost via Resolution Queue (integration)', () => {
  const gameId = 'test_discard_typed_activation_cost_resolution_queue';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it("enqueues DISCARD_SELECTION with filtered hand and resumes activation after discarding a creature card", async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
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
          oracle_text: 'Discard a creature card: Draw a card.',
          image_uris: { small: 'https://example.com/engine.jpg' },
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'h_creature',
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            mana_cost: '{1}{G}',
            image_uris: { small: 'https://example.com/bears.jpg' },
            zone: 'hand',
          },
          {
            id: 'h_instant',
            name: 'Giant Growth',
            type_line: 'Instant',
            mana_cost: '{G}',
            image_uris: { small: 'https://example.com/growth.jpg' },
            zone: 'hand',
          },
        ],
        graveyard: [],
        exile: [],
        handCount: 2,
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
    expect(step.type).toBe('discard_selection');
    expect(step.playerId).toBe(p1);
    expect(step.discardAbilityAsCost).toBe(true);
    expect(step.discardCount).toBe(1);

    const handOptions = step.hand as any[];
    expect(Array.isArray(handOptions)).toBe(true);
    expect(handOptions.some((c: any) => String(c.id) === 'h_creature')).toBe(true);
    expect(handOptions.some((c: any) => String(c.id) === 'h_instant')).toBe(false);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: ['h_creature'],
    });

    const zones = (game.state as any).zones?.[p1];
    expect(zones).toBeDefined();
    expect((zones.hand as any[]).some((c: any) => c && c.id === 'h_creature')).toBe(false);
    expect((zones.graveyard as any[]).some((c: any) => c && c.id === 'h_creature')).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack.length).toBe(1);
    expect(String(stack[0].type)).toBe('ability');
    expect(String(stack[0].source)).toBe('src_1');
    expect(String(stack[0].description || '').toLowerCase()).toContain('draw a card');

    expect(emitted.some((e) => e.room === gameId && e.event === 'stackUpdate')).toBe(true);
  });
});
