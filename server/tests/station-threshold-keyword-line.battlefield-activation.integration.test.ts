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

describe('Station activation with threshold on keyword-following line (integration)', () => {
  const gameId = 'test_station_threshold_keyword_line_activation';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('queues Station with the correct threshold and does not mark the spacecraft stationed early', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).phase = 'main1';
    (game.state as any).stack = [];

    (game.state as any).battlefield = [
      {
        id: 'src_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: { charge: 0 },
        card: {
          id: 'card_station_1',
          name: 'Squadron Carrier',
          type_line: 'Artifact — Spacecraft',
          oracle_text: 'Station\n10+ | Creatures you control have flying.',
          image_uris: { small: 'https://example.com/spacecraft.jpg' },
        },
      },
      {
        id: 'c_1',
        controller: p1,
        owner: p1,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'card_creature_1',
          name: 'Crewmate',
          type_line: 'Creature — Pilot',
          oracle_text: '',
          image_uris: { small: 'https://example.com/creature.jpg' },
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'card_station_1-station-0' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);

    const step = queue.steps[0] as any;
    expect(step.type).toBe('station_creature_selection');
    expect(Number(step.station?.threshold || 0)).toBe(10);
    expect(String(step.title || '')).toBe('Station 10');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: ['c_1'],
      cancelled: false,
    });

    const station = ((game.state as any).battlefield as any[]).find((perm) => perm.id === 'src_1');
    expect(Number(station?.counters?.charge || 0)).toBe(2);
    expect(Boolean(station?.stationed)).toBe(false);
  });
});