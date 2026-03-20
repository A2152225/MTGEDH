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

describe('optional discard then draw choice (integration)', () => {
  const gameId = 'test_optional_discard_then_draw_choice';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('does nothing when the player declines to discard', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [p1]: {
        hand: [{ id: 'card_1', name: 'Card One', type_line: 'Instant' }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: You may discard a card. If you do, draw a card.',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'discard', label: 'Discard a card' },
        { id: 'dont', label: "Don't discard" },
      ],
      minSelections: 1,
      maxSelections: 1,
      optionalDiscardThenDrawChoice: true,
      optionalDiscardThenDrawPlayerId: p1,
      optionalDiscardThenDrawSourceName: 'Source',
      optionalDiscardThenDrawCount: 1,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: 'dont' });

    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['card_1']);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('queues a discard selection with afterDiscardDrawCount when the player chooses to discard', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [p1]: {
        hand: [
          { id: 'card_1', name: 'Card One', type_line: 'Instant' },
          { id: 'card_2', name: 'Card Two', type_line: 'Sorcery' },
        ],
        handCount: 2,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: You may discard a card. If you do, draw a card.',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'discard', label: 'Discard a card' },
        { id: 'dont', label: "Don't discard" },
      ],
      minSelections: 1,
      maxSelections: 1,
      optionalDiscardThenDrawChoice: true,
      optionalDiscardThenDrawPlayerId: p1,
      optionalDiscardThenDrawSourceName: 'Source',
      optionalDiscardThenDrawCount: 1,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: 'discard' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).type).toBe('discard_selection');
    expect((queue.steps[0] as any).afterDiscardDrawCount).toBe(1);
    expect(((queue.steps[0] as any).hand || []).map((c: any) => c.id)).toEqual(['card_1', 'card_2']);
  });
});