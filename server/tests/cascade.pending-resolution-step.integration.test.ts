import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { registerJoinHandlers } from '../src/socket/join.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: 'sock_join_pending_cascade',
    data: { spectator: false },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
    join: (room: string) => {
      socket.rooms.add(room);
    },
  } as any;
  return { socket, handlers };
}

describe('joinGame pending cascade restore (integration)', () => {
  const gameId = 'test_join_pending_cascade_restore';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('rebuilds a cascade prompt from pending cast state before sending the join prompt', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        seatToken: 'seat_p1',
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 2,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game as any).libraries?.set?.(playerId, [
      {
        id: 'forest_1',
        name: 'Forest',
        type_line: 'Basic Land — Forest',
      },
      {
        id: 'lightning_bolt',
        name: 'Lightning Bolt',
        type_line: 'Instant',
        oracle_text: 'Deal 3 damage to any target.',
        mana_cost: '{R}',
        cmc: 1,
      },
    ]);
    (game.state as any).pendingCascade = {
      [playerId]: [
        {
          sourceName: 'Bloodbraid Elf',
          sourceCardId: 'bloodbraid_elf',
          manaValue: 4,
          instance: 1,
        },
      ],
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(emitted);
    const io = createMockIo(emitted);

    registerJoinHandlers(io as any, socket as any);

    await handlers['joinGame']({ gameId, fixedPlayerId: playerId });

    const stateEventIndex = emitted.findIndex((entry) => entry.event === 'state');
    const promptEventIndex = emitted.findIndex((entry) => entry.event === 'resolutionStepPrompt');
    const promptEvent = emitted[promptEventIndex];

    expect(stateEventIndex).toBeGreaterThanOrEqual(0);
    expect(promptEventIndex).toBeGreaterThan(stateEventIndex);
    expect(promptEvent?.payload?.step?.type).toBe('cascade');
    expect(promptEvent?.payload?.step?.sourceName).toBe('Bloodbraid Elf');
    expect(promptEvent?.payload?.step?.hitCard?.id).toBe('lightning_bolt');
    expect((game as any).libraries.get(playerId)?.map((card: any) => card.id)).toEqual([]);
  });
});