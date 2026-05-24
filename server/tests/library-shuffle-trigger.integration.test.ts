import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
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

describe('library shuffle triggers (integration)', () => {
  const gameId = 'test_library_shuffle_trigger';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues and persists Psychogenic Probe-style triggers when a library search shuffles', async () => {
    const p1 = 'p1';
    const p2 = 'p2';
    const forest = { id: 'forest_1', name: 'Forest', type_line: 'Basic Land - Forest', oracle_text: '', zone: 'library' };
    const island = { id: 'island_1', name: 'Island', type_line: 'Basic Land - Island', oracle_text: '', zone: 'library' };

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 2 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    (game as any).libraries = new Map([[p1, [forest, island]]]);
    (game.state as any).battlefield = [
      {
        id: 'probe_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        card: {
          id: 'psychogenic_probe_card',
          name: 'Psychogenic Probe',
          type_line: 'Artifact',
          oracle_text: 'Whenever a spell or ability causes a player to shuffle their library, this artifact deals 2 damage to that player.',
          zone: 'battlefield',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    socket.data.gameId = gameId;
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const searchStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId: p1 as any,
      sourceId: 'tutor_spell_1',
      sourceName: 'Test Tutor',
      description: 'Search your library for a basic land card, put it into your hand, then shuffle.',
      availableCards: [forest, island],
      destination: 'hand',
      remainderDestination: 'shuffle',
      shuffleAfter: true,
      mandatory: true,
    } as any) as any;

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(searchStep.id),
      selections: ['forest_1'],
    });

    const queued = ((game.state as any).stack || []).find((item: any) => item?.sourceName === 'Psychogenic Probe');
    expect(queued).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'library_shuffle',
      targetPlayer: p1,
      triggeringPlayer: p1,
      effect: 'this artifact deals 2 damage to that player',
    }));
    expect(queued?.effectData).toEqual(expect.objectContaining({
      shuffledPlayerId: p1,
      causeSourceId: 'tutor_spell_1',
      causeSourceName: 'Test Tutor',
    }));

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && event?.payload?.sourceName === 'Psychogenic Probe'
    );
    expect(triggerEvents).toHaveLength(1);
    expect(triggerEvents[0]?.payload?.effectData?.shuffledPlayerId).toBe(p1);

    game.resolveTopOfStack();

    expect((game.state.life as any)[p1]).toBe(38);
    expect((game.state as any).damageTakenThisTurnByPlayer?.[p1]).toBe(2);
  });
});