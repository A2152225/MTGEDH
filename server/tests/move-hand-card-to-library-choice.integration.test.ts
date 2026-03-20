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

describe('move chosen hand card to library choice (integration)', () => {
  const gameId = 'test_move_hand_card_to_library_choice';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('puts the selected hand card on top of the library', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [p1]: {
        hand: [
          { id: 'hand_a', name: 'Card A', type_line: 'Sorcery' },
          { id: 'hand_b', name: 'Card B', type_line: 'Instant' },
        ],
        handCount: 2,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 1,
      },
    };
    (game as any).libraries = new Map([[p1, [{ id: 'lib_1', name: 'Existing Top', type_line: 'Land', zone: 'library' }]]]);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: Choose a card from your hand to put on top of your library.',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'hand_a', label: 'Card A' },
        { id: 'hand_b', label: 'Card B' },
      ],
      minSelections: 1,
      maxSelections: 1,
      moveChosenHandCardToLibraryChoice: true,
      moveChosenHandCardToLibraryController: p1,
      moveChosenHandCardToLibrarySourceName: 'Source',
      moveChosenHandCardToLibraryPosition: 'top',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: 'hand_b' });

    const lib = (game as any).libraries.get(p1) || [];
    expect(lib.map((c: any) => c.id)).toEqual(['hand_b', 'lib_1']);
    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['hand_a']);
  });

  it('puts the selected hand card on the bottom of the library', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [p1]: {
        hand: [
          { id: 'hand_a', name: 'Card A', type_line: 'Sorcery' },
          { id: 'hand_b', name: 'Card B', type_line: 'Instant' },
        ],
        handCount: 2,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 1,
      },
    };
    (game as any).libraries = new Map([[p1, [{ id: 'lib_1', name: 'Existing Top', type_line: 'Land', zone: 'library' }]]]);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: Choose a card from your hand to put on the bottom of your library.',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'hand_a', label: 'Card A' },
        { id: 'hand_b', label: 'Card B' },
      ],
      minSelections: 1,
      maxSelections: 1,
      moveChosenHandCardToLibraryChoice: true,
      moveChosenHandCardToLibraryController: p1,
      moveChosenHandCardToLibrarySourceName: 'Source',
      moveChosenHandCardToLibraryPosition: 'bottom',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: 'hand_a' });

    const lib = (game as any).libraries.get(p1) || [];
    expect(lib.map((c: any) => c.id)).toEqual(['lib_1', 'hand_a']);
    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['hand_b']);
  });
});