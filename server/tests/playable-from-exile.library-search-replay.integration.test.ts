import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

function seedGame(gameId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  const playerId = 'p1';
  const library = [
    {
      id: 'creature_lib_1',
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
      mana_cost: '{1}{G}',
      zone: 'library',
    },
  ];

  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  game.importDeckResolved(playerId as any, library as any);
  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: library.length,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    },
  };

  return { game, playerId, libraryCard: library[0] };
}

describe('playable-from-exile library-search replay semantics (integration)', () => {
  const gameId = 'test_playable_from_exile_library_search_replay';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('persists and replays exile-play permissions from a resolved library search', async () => {
    const { game, playerId, libraryCard } = seedGame(gameId);
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerResolutionHandlers(io as any, socket as any);

    const searchStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId,
      description: 'Source: Exile a creature face down.',
      mandatory: true,
      sourceId: 'source_perm_1',
      sourceName: 'Source',
      searchCriteria: '1 card',
      minSelections: 1,
      maxSelections: 1,
      destination: 'exile',
      reveal: false,
      shuffleAfter: false,
      remainderDestination: 'none',
      destinationFaceDown: true,
      grantPlayableFromExileToController: true,
      playableFromExileTypeKey: 'creature',
      persistLibrarySearchResolve: true,
      availableCards: [{ ...libraryCard }],
    } as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(searchStep.id),
      selections: ['creature_lib_1'],
    });

    const liveZones = (game.state as any).zones?.[playerId];
    expect((liveZones?.exile || []).map((card: any) => card.id)).toEqual(['creature_lib_1']);
    expect(liveZones?.exile?.[0]?.faceDown).toBe(true);
    expect((game.state as any).playableFromExile?.[playerId]?.creature_lib_1).toBe(true);

    const resolvedEvent = [...getEvents(gameId)].reverse().find((event) => event.type === 'librarySearchResolve') as any;
    expect(resolvedEvent).toBeDefined();
    expect(resolvedEvent.payload?.grantPlayableFromExileToController).toBe(true);
    expect(resolvedEvent.payload?.playableFromExileTypeKey).toBe('creature');
    expect((resolvedEvent.payload?.selectedCardIds || [])).toEqual(['creature_lib_1']);

    const replayGameId = `${gameId}_replay`;
    const { game: replayGame } = seedGame(replayGameId);
    replayGame.applyEvent({
      type: 'librarySearchResolve',
      ...((resolvedEvent as any).payload || {}),
    });

    const replayZones = (replayGame.state as any).zones?.[playerId];
    expect((replayZones?.exile || []).map((card: any) => card.id)).toEqual(['creature_lib_1']);
    expect(replayZones?.exile?.[0]?.faceDown).toBe(true);
    expect((replayGame.state as any).playableFromExile?.[playerId]?.creature_lib_1).toBe(true);
    expect(((replayGame as any).libraries?.get?.(playerId) || []).map((card: any) => card.id)).toEqual(
      (((resolvedEvent as any).payload?.libraryAfter) || []).map((card: any) => card.id),
    );
  });
});