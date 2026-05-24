import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

function createMockSocket(
  data: { playerId: string; spectator?: boolean; gameId?: string },
  emitted: Array<{ room?: string; event: string; payload: any }>,
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { spectator: false, ...data },
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    truncateEventsForUndo(gameId, 0);
  } catch {
    // ignore
  }
  await deleteGame(gameId);
}

describe('lifegain triggers (integration)', () => {
  const gameId = 'test_lifegain_trigger_ajani';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues ordinary lifegain triggers on the stack and resolves named self counters', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'ajani_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        summoningSickness: false,
        card: {
          id: 'ajani_card',
          name: "Ajani's Pridemate",
          type_line: 'Creature - Cat Soldier',
          oracle_text: "Whenever you gain life, put a +1/+1 counter on Ajani's Pridemate.",
          power: '2',
          toughness: '2',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, gameId }, emitted);
    socket.rooms.add(gameId);
    registerGameActions(createMockIo(emitted), socket as any);

    await handlers.adjustLife({ gameId, delta: 3, targetPlayerId: p1 });

    expect((game.state.life as any)[p1]).toBe(43);
    expect((game.state as any).lifeGainedThisTurn?.[p1]).toBe(3);
    expect((game.state as any).pendingTriggers).toBeUndefined();

    const lifegainStackItems = (((game.state as any).stack || []) as any[]).filter((item: any) => item?.source === 'ajani_perm');
    expect(lifegainStackItems).toHaveLength(1);
    expect(lifegainStackItems[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'lifegain',
      sourceName: "Ajani's Pridemate",
      triggeringPlayer: p1,
      effect: "put a +1/+1 counter on ajani's pridemate",
    }));

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && event?.payload?.sourceName === "Ajani's Pridemate"
    );
    expect(triggerEvents).toHaveLength(1);

    game.resolveTopOfStack();

    const ajani = (((game.state as any).battlefield || []) as any[]).find((perm: any) => perm?.id === 'ajani_perm');
    expect(ajani?.counters?.['+1/+1']).toBe(1);
  });
});