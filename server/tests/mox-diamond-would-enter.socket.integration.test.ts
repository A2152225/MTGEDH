import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { tryQueueWouldEnterDiscardLandBeforeStackResolve } from '../src/state/modules/land-would-enter-replacement.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import GameManager from '../src/GameManager.js';

const MOX_DIAMOND_ORACLE =
  "If Mox Diamond would enter the battlefield, you may discard a land card instead. If you do, put Mox Diamond onto the battlefield. If you don't, put it into its owner's graveyard.\n{T}: Add one mana of any color.";

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId: undefined },
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
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // test-only cleanup
  }
}

function seedMoxDiamondGame(gameId: string, playerId: string) {
  createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  games.set(gameId as any, game as any);

  Object.assign(game.state as any, {
    id: gameId,
    players: [{ id: playerId, name: 'P1', spectator: false, life: 40, isAI: false }],
    startingLife: 40,
    life: { [playerId]: 40 },
    phase: 'precombatMain',
    step: 'MAIN1',
    turnPlayer: playerId,
    priority: playerId,
    stack: [
      {
        id: 'mox_stack_1',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'mox_card_1',
          name: 'Mox Diamond',
          type_line: 'Artifact',
          oracle_text: MOX_DIAMOND_ORACLE,
        },
      },
    ],
    battlefield: [],
    zones: {
      [playerId]: {
        hand: [
          {
            id: 'plains_1',
            name: 'Plains',
            type_line: 'Basic Land — Plains',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    },
  });

  return game;
}

describe('Mox Diamond would-enter discard land (socket integration)', () => {
  const gameId = 'test_mox_diamond_socket';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('defers stack resolve and submitResolutionResponse discards a land to enter', async () => {
    const game = seedMoxDiamondGame(gameId, playerId);
    expect(tryQueueWouldEnterDiscardLandBeforeStackResolve(game)).toBe(true);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = gameId;
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);

    const moxStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any)
      .find((step: any) => step.moxDiamondChoice === true) as any;
    expect(moxStep).toBeTruthy();
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).battlefield).toHaveLength(0);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(moxStep.id),
      selections: ['plains_1'],
      cancelled: false,
    });

    const errorCodes = emitted
      .filter((entry) => entry.event === 'error')
      .map((entry) => entry.payload?.code);
    expect(errorCodes).toEqual([]);

    expect((game.state as any).stack).toHaveLength(0);
    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.id).toBe('mox_stack_1');
    expect(battlefield[0]?.card?.name).toBe('Mox Diamond');

    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(graveyard.map((card: any) => card.id)).toEqual(['plains_1']);

    const events = await getEvents(gameId);
    const choiceEvents = events.filter((event: any) => event.type === 'moxDiamondChoice');
    expect(choiceEvents.length).toBeGreaterThanOrEqual(1);
    expect(choiceEvents[choiceEvents.length - 1]?.payload?.discardLandId).toBe('plains_1');
  });

  it('submitResolutionResponse decline puts Mox Diamond into the graveyard', async () => {
    const game = seedMoxDiamondGame(gameId, playerId);
    expect(tryQueueWouldEnterDiscardLandBeforeStackResolve(game)).toBe(true);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = gameId;
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);

    const moxStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any)
      .find((step: any) => step.moxDiamondChoice === true) as any;
    expect(moxStep).toBeTruthy();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(moxStep.id),
      selections: ['decline_mox_diamond'],
      cancelled: false,
    });

    expect((game.state as any).battlefield).toHaveLength(0);
    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(graveyard.map((card: any) => card.name)).toEqual(['Mox Diamond']);
    expect((game.state as any).zones?.[playerId]?.hand).toHaveLength(1);
  });
});
