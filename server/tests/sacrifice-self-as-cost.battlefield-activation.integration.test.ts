import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists, getEvents } from '../src/db/index.js';
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

describe('Sacrifice self as activation cost (integration)', () => {
  const gameId = 'test_sacrifice_self_activation_cost';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('sacrifices the source immediately and puts the ability on the stack', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        handCount: 0,
        libraryCount: 0,
        graveyardCount: 0,
        exileCount: 0,
      },
    };

    (game.state as any).battlefield = [
      {
        id: 'src_1',
        controller: p1,
        owner: p1,
        tapped: false,
        isToken: false,
        card: {
          name: 'Test Sacrifice Artifact',
          type_line: 'Artifact',
          oracle_text: '{2}, {T}, Pay 2 life, Sacrifice this artifact: You gain 3 life.',
          image_uris: { small: 'https://example.com/art.jpg' },
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    expect(typeof handlers['activateBattlefieldAbility']).toBe('function');
  expect((game.state as any).life?.[p1]).toBe(40);
    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });

  // Life is paid after activation succeeds
  expect((game.state as any).life?.[p1]).toBe(38);

    const battlefield = (game.state as any).battlefield || [];
    expect((battlefield as any[]).some((p: any) => p && String(p.id) === 'src_1')).toBe(false);

    const zones = (game.state as any).zones?.[p1];
    expect(zones).toBeDefined();
    expect(Array.isArray(zones.graveyard)).toBe(true);
    expect((zones.graveyard as any[]).some((c: any) => String(c?.name || '') === 'Test Sacrifice Artifact')).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack.length).toBe(1);
    expect(String(stack[0].type)).toBe('ability');
    expect(String(stack[0].source)).toBe('src_1');
    expect(String(stack[0].description || '').toLowerCase()).toContain('gain 3 life');

    expect(emitted.some((e) => e.room === gameId && e.event === 'stackUpdate')).toBe(true);

    // Determinism: activation evidence should be persisted on activateBattlefieldAbility
    const events = getEvents(gameId);
    const activationEvents = events.filter((e) => String(e?.type) === 'activateBattlefieldAbility');
    expect(activationEvents.length).toBeGreaterThan(0);
    const last = activationEvents[activationEvents.length - 1] as any;
    expect(last?.payload?.lifePaidForCost).toBe(2);
    expect(Array.isArray(last?.payload?.sacrificedPermanents)).toBe(true);
    expect((last?.payload?.sacrificedPermanents || []).map(String)).toContain('src_1');
  });
});
