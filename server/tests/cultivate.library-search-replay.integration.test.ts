import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stack.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
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

describe('Cultivate library search replay', () => {
  const gameId = 'test_cultivate_library_search_replay';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('persists split library search results for Cultivate so replay does not need a fresh prompt', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 3,
      },
    };
    (game as any).libraries = new Map([
      [playerId, [
        { id: 'forest_a', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', image_uris: { normal: 'forest.png' } },
        { id: 'plains_b', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '', image_uris: { normal: 'plains.png' } },
        { id: 'spell_c', name: 'Giant Growth', type_line: 'Instant', oracle_text: '', image_uris: { normal: 'growth.png' } },
      ]],
    ]);
    (game.state as any).stack = [
      {
        id: 'cultivate_stack_1',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'cultivate_1',
          name: 'Cultivate',
          type_line: 'Sorcery',
          oracle_text: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
          mana_cost: '{2}{G}',
        },
        targets: [],
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    expect(step).toBeDefined();
    expect(step.splitDestination).toBe(true);
    expect(step.persistLibrarySearchResolve).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: ['forest_a', 'plains_b'],
      splitAssignments: {
        toBattlefield: ['forest_a'],
        toHand: ['plains_b'],
      },
    });

    const resolvedEvent = [...getEvents(gameId)].reverse().find((event) => event.type === 'librarySearchResolve') as any;
    expect(resolvedEvent).toBeDefined();
    expect(resolvedEvent.payload?.splitAssignments).toEqual({
      toBattlefield: ['forest_a'],
      toHand: ['plains_b'],
    });
    expect((resolvedEvent.payload?.selectedCardIds || [])).toEqual(['forest_a', 'plains_b']);

    const liveZones = (game.state as any).zones?.[playerId];
    const liveBattlefield = (game.state as any).battlefield || [];
    expect((liveZones?.hand || []).map((card: any) => card.id)).toEqual(['plains_b']);
    expect(liveBattlefield.some((permanent: any) => permanent?.card?.id === 'forest_a' && permanent?.tapped === true)).toBe(true);

    const replayGame = createInitialGameState('test_cultivate_library_search_replay_apply');
    const replayPlayerId = playerId as PlayerID;
    replayGame.applyEvent({ type: 'join', playerId: replayPlayerId, name: 'P1' });
    (replayGame.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    replayGame.applyEvent({
      type: 'librarySearchResolve',
      ...resolvedEvent.payload,
    });

    const replayZones = (replayGame.state as any).zones?.[playerId];
    const replayBattlefield = (replayGame.state as any).battlefield || [];
    expect((replayZones?.hand || []).map((card: any) => card.id)).toEqual(['plains_b']);
    expect(replayBattlefield.some((permanent: any) => permanent?.card?.id === 'forest_a' && permanent?.tapped === true)).toBe(true);
    expect((replayZones?.library || []).map((card: any) => card.id)).toEqual(
      ((resolvedEvent.payload?.libraryAfter || []) as any[]).map((card: any) => card.id),
    );
    expect(replayGame.peekTopN(replayPlayerId, 10).map((card: any) => card.id)).toEqual(
      ((resolvedEvent.payload?.libraryAfter || []) as any[]).map((card: any) => card.id),
    );
  });
});