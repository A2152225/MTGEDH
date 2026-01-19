import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame, getPlayerName } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { enqueueEdictCreatureSacrificeStep } from '../src/socket/sacrifice-resolution.js';

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

describe('Edict sacrifice via Resolution Queue (integration)', () => {
  const gameId = 'test_edict_sacrifice_resolution_queue';

  beforeAll(async () => {
    await initDb();

    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('enqueues an UPKEEP_SACRIFICE step and sacrifices the selected creature', async () => {
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

    // Establish a deterministic priority baseline.
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).battlefield = [
      {
        id: 'c_1',
        controller: p2,
        owner: p2,
        basePower: 2,
        baseToughness: 2,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          image_uris: { small: 'https://example.com/bears.jpg' },
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 },
      [p2]: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p2, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const enqueued = enqueueEdictCreatureSacrificeStep(io as any, game as any, gameId, p2, {
      sourceName: 'Grave Pact',
      sourceControllerId: p1,
      reason: 'Whenever a creature you control dies, each other player sacrifices a creature.',
      sourceId: 'src_grave_pact',
    });

    expect(enqueued).toBe(1);
    expect((game.state as any).priority).toBe(null);

    const promptEvt = emitted.find(e => e.event === 'resolutionStepPrompt');
    expect(promptEvt).toBeDefined();
    expect(emitted.some(e => e.event === 'sacrificeSelectionRequest')).toBe(false);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);

    const step = queue.steps[0] as any;
    expect(step.type).toBe('upkeep_sacrifice');
    expect(step.playerId).toBe(p2);
    expect(step.allowSourceSacrifice).toBe(false);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: 'c_1' });

    expect((game.state as any).priority).toBe(p1);

    const stillThere = (game.state as any).battlefield.find((p: any) => p.id === 'c_1');
    expect(stillThere).toBeUndefined();

    const gy = (game.state as any).zones[p2].graveyard;
    expect(gy.length).toBe(1);
    expect(gy[0].name).toBe('Grizzly Bears');

    // Sanity: chat emitted includes player name.
    const chatEvt = emitted.find(e => e.room === gameId && e.event === 'chat');
    expect(chatEvt).toBeDefined();
    expect(String(chatEvt!.payload.message || '')).toContain(getPlayerName(game as any, p2));
  });
});
