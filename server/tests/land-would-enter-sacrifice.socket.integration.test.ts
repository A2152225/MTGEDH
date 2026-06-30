import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import GameManager from '../src/GameManager.js';

const LOTUS_VALE_ORACLE =
  "If this land would enter, sacrifice two untapped lands instead. If you do, put this land onto the battlefield. If you don't, put it into its owner's graveyard.\n{T}: Add three mana of any one color.";

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

function seedLotusValeGame(gameId: string, playerId: string) {
  createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  games.set(gameId as any, game as any);

  Object.assign(game.state as any, {
    players: [{ id: playerId, name: 'P1', spectator: false, life: 40, isAI: false }],
    startingLife: 40,
    life: { [playerId]: 40 },
    phase: 'precombatMain',
    step: 'MAIN1',
    turnPlayer: playerId,
    priority: playerId,
    stack: [],
    landsPlayedThisTurn: { [playerId]: 0 },
    battlefield: [
      {
        id: 'land_a',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { id: 'plains_a', name: 'Plains', type_line: 'Basic Land — Plains' },
      },
      {
        id: 'land_b',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { id: 'forest_b', name: 'Forest', type_line: 'Basic Land — Forest' },
      },
    ],
    zones: {
      [playerId]: {
        hand: [
          {
            id: 'lotus_vale_1',
            name: 'Lotus Vale',
            type_line: 'Land',
            oracle_text: LOTUS_VALE_ORACLE,
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

describe('Lotus Vale would-enter sacrifice (socket integration)', () => {
  const gameId = 'test_lotus_vale_socket';
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

  it('playLand defers ETB and submitResolutionResponse completes sacrifice + entry', async () => {
    const game = seedLotusValeGame(gameId, playerId);
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = gameId;
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['playLand']({ gameId, cardId: 'lotus_vale_1', fromZone: 'hand' });

    const errorCodes = emitted
      .filter((entry) => entry.event === 'error')
      .map((entry) => entry.payload?.code);
    expect(errorCodes).toEqual([]);

    expect((game.state as any).battlefield).toHaveLength(2);
    expect((game.state as any).zones?.[playerId]?.hand).toHaveLength(0);
    expect(game.state.landsPlayedThisTurn?.[playerId]).toBe(1);

    const choiceStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any)
      .find((step: any) => step.landWouldEnterSacrificeChoice === true) as any;
    expect(choiceStep).toBeTruthy();
    expect(choiceStep.type).toBe(ResolutionStepType.OPTION_CHOICE);
    expect(choiceStep.sacrificeCount).toBe(2);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(choiceStep.id),
      selections: ['land_a', 'land_b'],
      cancelled: false,
    });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.card?.name).toBe('Lotus Vale');

    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(graveyard.map((card: any) => card.id)).toEqual(['plains_a', 'forest_b']);

    const events = await getEvents(gameId);
    const choiceEvents = events.filter((event: any) => event.type === 'landWouldEnterSacrificeChoice');
    expect(choiceEvents.length).toBeGreaterThanOrEqual(1);
    expect(choiceEvents[choiceEvents.length - 1]?.payload?.sacrificePermanentIds).toEqual(['land_a', 'land_b']);
  });

  it('submitResolutionResponse decline puts Lotus Vale into the graveyard', async () => {
    const game = seedLotusValeGame(gameId, playerId);
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = gameId;
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['playLand']({ gameId, cardId: 'lotus_vale_1', fromZone: 'hand' });

    const choiceStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any)
      .find((step: any) => step.landWouldEnterSacrificeChoice === true) as any;
    expect(choiceStep).toBeTruthy();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(choiceStep.id),
      selections: ['decline_land_would_enter'],
      cancelled: false,
    });

    expect((game.state as any).battlefield).toHaveLength(2);
    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(graveyard).toHaveLength(1);
    expect(graveyard[0]?.name).toBe('Lotus Vale');
  });
});
