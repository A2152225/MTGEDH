import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { createInitialGameState } from '../src/state/index.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { assertNoReplayDivergence, toReplayEvents } from './helpers/replayDivergence.js';

const REVERSE_THE_SANDS_TEXT =
  "Redistribute any number of players' life totals. (Each of those players gets one life total back.)";

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => undefined }),
    emit: (_event: string, _payload: any) => undefined,
    sockets: { sockets: new Map() },
  } as any;
}

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

function seedLifeRedistributionBoard(game: any, playerId: PlayerID) {
  const p2 = 'p2' as PlayerID;
  const p3 = 'p3' as PlayerID;

  (game.state as any).players = [
    { id: playerId, name: 'Alice', spectator: false, life: 20, isAI: false },
    { id: p2, name: 'Bob', spectator: false, life: 30, isAI: false },
    { id: p3, name: 'Carol', spectator: false, life: 40, isAI: false },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 20, p2: 30, p3: 40 };
  (game.state as any).phase = 'main1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).zones = {
    [playerId]: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0, library: [], libraryCount: 0 },
    [p2]: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0, library: [], libraryCount: 0 },
    [p3]: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0, library: [], libraryCount: 0 },
  };

  return { p2, p3 };
}

describe('life redistribution socket replay integration', () => {
  const gameId = 'test_life_redistribution_socket_replay';
  const replayGameId = `${gameId}_replay`;
  const playerId = 'p1' as PlayerID;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  it('persists resolveTopOfStackPrompt when redistribution is queued and replays the pending prompt', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedLifeRedistributionBoard(game, playerId);
    (game as any).gameId = gameId;

    const eventStart = getEvents(gameId).length;

    const steps = parseOracleTextToIR(REVERSE_THE_SANDS_TEXT, 'Reverse the Sands').abilities?.[0]?.steps || [];
    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'reverse-the-sands-1',
      sourceName: 'Reverse the Sands',
    });

    applyOracleIRStepsOnServer(
      game as any,
      (game.state as any),
      steps,
      irCtx,
      { allowOptional: false },
      { controller: playerId },
    );

    const promptEvents = toReplayEvents(gameId, eventStart);
    expect(promptEvents.some((event: any) => event.type === 'resolveTopOfStackPrompt')).toBe(true);
    const promptEvent = promptEvents.find((event: any) => event.type === 'resolveTopOfStackPrompt') as any;
    expect(promptEvent?.queuedResolutionStep?.type).toBe(ResolutionStepType.LIFE_REDISTRIBUTION);

    const replayGame = createInitialGameState(replayGameId);
    seedLifeRedistributionBoard(replayGame, playerId);
    replayGame.replay!(promptEvents as any);

    const restoredStep = ResolutionQueueManager.getStepsForPlayer(replayGameId, playerId)
      .find((step: any) => step?.type === ResolutionStepType.LIFE_REDISTRIBUTION);
    expect(restoredStep).toBeDefined();
    expect((restoredStep as any)?.players).toEqual([
      { id: 'p1', name: 'Alice', life: 20 },
      { id: 'p2', name: 'Bob', life: 30 },
      { id: 'p3', name: 'Carol', life: 40 },
    ]);
    expect((replayGame.state as any).life).toEqual({ p1: 20, p2: 30, p3: 40 });
  });

  it('persists lifeRedistributionResolve from socket path and replays chosen totals', { timeout: 60_000 }, async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedLifeRedistributionBoard(game, playerId);
    (game as any).gameId = gameId;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);
    (game as any).io = io;

    const eventStart = getEvents(gameId).length;

    const steps = parseOracleTextToIR(REVERSE_THE_SANDS_TEXT, 'Reverse the Sands').abilities?.[0]?.steps || [];
    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'reverse-the-sands-1',
      sourceName: 'Reverse the Sands',
    });

    applyOracleIRStepsOnServer(
      game as any,
      (game.state as any),
      steps,
      irCtx,
      { allowOptional: false },
      { controller: playerId },
    );

    const redistributionStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)
      .find((step: any) => step?.type === ResolutionStepType.LIFE_REDISTRIBUTION);
    expect(redistributionStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((redistributionStep as any).id),
      selections: {
        lifeByPlayerId: {
          p1: 40,
          p2: 30,
          p3: 20,
        },
      },
      cancelled: false,
    });

    expect((game.state as any).life).toEqual({ p1: 40, p2: 30, p3: 20 });
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, playerId)).toEqual([]);

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.some((event: any) =>
      event.type === 'lifeRedistributionResolve'
      && event.lifeByPlayerId?.p1 === 40
      && event.lifeByPlayerId?.p3 === 20,
    )).toBe(true);

    const replayGame = createInitialGameState(replayGameId);
    seedLifeRedistributionBoard(replayGame, playerId);

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    expect((replayGame.state as any).life).toEqual({ p1: 40, p2: 30, p3: 20 });
    expect(ResolutionQueueManager.getStepsForPlayer(replayGameId, playerId)).toEqual([]);

    assertNoReplayDivergence(game, replayGame);
  });
});
