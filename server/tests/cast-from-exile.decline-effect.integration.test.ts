import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

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

function createMockSocket(
  playerId: string,
  emitted: Array<{ room?: string; event: string; payload: any }>,
  gameId?: string
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

describe('generic cast-from-exile decline effects (integration)', () => {
  const gameId = 'test_cast_from_exile_decline_effect';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('applies a decline fallback effect to each opponent', async () => {
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    const p2 = 'p2' as any;
    const p3 = 'p3' as any;

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
      { id: p3, name: 'P3', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40, [p3]: 40 };
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        exile: [
          {
            id: 'exiled_1',
            name: 'Lightning Strike',
            type_line: 'Instant',
            oracle_text: 'Lightning Strike deals 3 damage to any target.',
            zone: 'exile',
          },
        ],
        exileCount: 1,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
      [p2]: { hand: [], handCount: 0, exile: [], exileCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0 },
      [p3]: { hand: [], handCount: 0, exile: [], exileCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0 },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Chandra: You may cast Lightning Strike. If you do not, Chandra deals 3 damage to each opponent.',
      mandatory: false,
      sourceName: 'Chandra, Torch of Defiance',
      options: [
        { id: 'cast', label: 'Cast Lightning Strike' },
        { id: 'decline', label: "Don't cast" },
      ],
      minSelections: 1,
      maxSelections: 1,
      castFromExileCardId: 'exiled_1',
      castFromExileCard: {
        id: 'exiled_1',
        name: 'Lightning Strike',
        type_line: 'Instant',
        oracle_text: 'Lightning Strike deals 3 damage to any target.',
        zone: 'exile',
      },
      castFromExileDeclineDestination: 'exile',
      castFromExileDeclineDamageEachOpponent: 3,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: 'decline' });

    expect((game.state as any).life[p1]).toBe(40);
    expect((game.state as any).life[p2]).toBe(37);
    expect((game.state as any).life[p3]).toBe(37);
    expect(((game.state as any).zones[p1].exile || []).map((c: any) => c.id)).toEqual(['exiled_1']);

    const chat = emitted.find((event) => event.event === 'chat');
    expect(chat?.payload?.message).toContain('deals 3 damage to each opponent');
  });
});
