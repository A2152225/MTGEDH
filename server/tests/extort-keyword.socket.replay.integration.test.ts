import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { createInitialGameState } from '../src/state/index.js';
import { assertNoReplayDivergence, toReplayEvents } from './helpers/replayDivergence.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function seedExtortBoard(game: any, playerId: PlayerID, opponentId: PlayerID) {
  const extortPermanent = {
    id: 'extort_perm',
    controller: playerId,
    owner: playerId,
    counters: {},
    card: {
      id: 'extort_card',
      name: 'Extort Test Permanent',
      type_line: 'Creature — Spirit',
      oracle_text: 'Extort',
    },
  };

  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
    { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).manaPool = {
    [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).battlefield = [extortPermanent];
  (game.state as any).stack = [];
  (game.state as any).zones = {
    [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0 },
    [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0 },
  };

  return extortPermanent;
}

describe('extort keyword socket replay integration', () => {
  const gameId = 'test_extort_keyword_socket_replay';
  const replayGameId = `${gameId}_replay`;
  const playerId = 'p1' as PlayerID;
  const opponentId = 'p2' as PlayerID;

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  it('persists keywordPromptResolve and replays extort life without re-prompting', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;

    const extortPermanent = seedExtortBoard(game, playerId, opponentId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    (game as any).io = io;

    const eventStart = getEvents(gameId).length;

    executeTriggerEffect(
      game as any,
      playerId,
      'Extort Test Permanent',
      'Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.',
      {
        source: 'extort_perm',
        permanentId: 'extort_perm',
        triggerType: 'cast',
        card: extortPermanent.card,
        spellCast: { card: { name: 'Test Spell' } },
      },
    );

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (entry: any) => entry?.type === ResolutionStepType.EXTORT_PAYMENT,
    ) as any;
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: {
        payment: [{ permanentId: '__pool__:white', mana: 'W', count: 1 }],
      },
    });

    expect((game.state as any).life[playerId]).toBe(41);
    expect((game.state as any).life[opponentId]).toBe(39);
    expect((game.state as any).manaPool[playerId].white).toBe(0);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, playerId)).toEqual([]);

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.some((event: any) =>
      event.type === 'keywordPromptResolve'
      && event.keyword === 'extort'
      && event.paymentManaDelta?.white === -1,
    )).toBe(true);

    const replayGame = createInitialGameState(replayGameId);
    seedExtortBoard(replayGame, playerId, opponentId);
    replayGame.replay!(replayEvents as any);

    expect((replayGame.state as any).life[playerId]).toBe(41);
    expect((replayGame.state as any).life[opponentId]).toBe(39);
    expect((replayGame.state as any).manaPool[playerId].white).toBe(0);
    expect(ResolutionQueueManager.getStepsForPlayer(replayGameId, playerId)).toEqual([]);

    assertNoReplayDivergence(game, replayGame);
  });
});
