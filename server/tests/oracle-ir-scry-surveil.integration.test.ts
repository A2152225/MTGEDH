import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import {
  applyOracleIRStepsOnServer,
  maybeApplyOracleIrChoiceStepFromResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

const gameId = 'test_oracle_ir_scry_surveil_socket';
const playerId = 'p1' as PlayerID;

function setupLibraryGame(gameId: string, library: Array<Record<string, unknown>>) {
  const game = createInitialGameState(gameId);
  game.applyEvent!({ type: 'join', playerId, name: 'P1' } as any);

  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      libraryCount: library.length,
    },
  };

  const player = (game.state as any).players.find((entry: any) => entry.id === playerId);
  player.library = library.map((card) => ({ ...card, zone: 'library' }));

  const ctx = game as any;
  ctx.gameId = gameId;
  ctx.libraries = new Map([[playerId, player.library.map((card: any) => ({ ...card }))]]);
  ResolutionQueueManager.removeQueue(gameId);

  return { game, ctx, player };
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
  const handlers: Record<string, (payload: any) => Promise<void> | void> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: (payload: any) => Promise<void> | void) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
  };
  return { socket, handlers };
}

describe('oracle IR scry/surveil queue adapter', () => {
  it('queues scry with oracleIrChoiceStepJson and IR resume metadata', () => {
    const localGameId = 'oracle_ir_scry_queue_shape';
    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest' },
      { id: 'top-2', name: 'Bolt', type_line: 'Instant' },
    ];
    const { game, ctx } = setupLibraryGame(localGameId, library);

    const step = {
      kind: 'scry',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 2 },
      raw: 'Scry 2.',
    } as const;

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'test-scry-1',
      sourceName: 'Test Scry',
    });

    applyOracleIRStepsOnServer(ctx, game.state as any, [step], irCtx, { allowOptional: false }, { controller: playerId });

    const scryStep = ResolutionQueueManager.getStepsForPlayer(localGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;

    expect(scryStep).toBeTruthy();
    expect(scryStep.scryCount).toBe(2);
    expect(String(scryStep.oracleIrChoiceStepJson || '')).toContain('scry');
    expect(scryStep.persistOracleIrScryResolve).toBe(true);
    expect(scryStep.oracleIrControllerId).toBe(playerId);

    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, scryStep, {
      selections: {
        keepTopOrder: ['top-2'],
        bottomOrder: ['top-1'],
      },
    });
    expect(resumed?.appliedSteps.map((entry) => entry.kind)).toEqual(['scry']);
    expect((game.state as any).oracleIrAppliedStepKinds?.get(0)).toBe('scry');
  });

  it('queues surveil with oracleIrChoiceStepJson and IR resume metadata', () => {
    const localGameId = 'oracle_ir_surveil_queue_shape';
    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest' },
      { id: 'top-2', name: 'Bolt', type_line: 'Instant' },
    ];
    const { game, ctx } = setupLibraryGame(localGameId, library);

    const step = {
      kind: 'surveil',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 2 },
      raw: 'Surveil 2.',
    } as const;

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'test-surveil-1',
      sourceName: 'Test Surveil',
    });

    applyOracleIRStepsOnServer(ctx, game.state as any, [step], irCtx, { allowOptional: false }, { controller: playerId });

    const surveilStep = ResolutionQueueManager.getStepsForPlayer(localGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SURVEIL) as any;

    expect(surveilStep).toBeTruthy();
    expect(surveilStep.surveilCount).toBe(2);
    expect(String(surveilStep.oracleIrChoiceStepJson || '')).toContain('surveil');
    expect(surveilStep.persistOracleIrSurveilResolve).toBe(true);
  });
});

describe('oracle IR scry/surveil socket persist + replay', () => {
  beforeAll(() => {
    initDb();
    initializePriorityResolutionHandler({
      to: () => ({ emit: () => {} }),
      emit: () => {},
      sockets: { sockets: new Map() },
    } as any);
  });

  beforeEach(() => {
    deleteGame(gameId);
    games.delete(gameId);
    ResolutionQueueManager.removeQueue(gameId);
  });

  afterEach(() => {
    deleteGame(gameId);
    games.delete(gameId);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('persists scryResolve ledger fields when IR-bridged scry resolves via socket', async () => {
    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'top-2', name: 'Bolt', type_line: 'Instant', image_uris: { normal: 'bolt.png' } },
    ];

    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: library.map((card) => ({ ...card, zone: 'library' })),
        libraryCount: library.length,
      },
    };
    const player = (game.state as any).players.find((entry: any) => entry.id === playerId);
    player.library = library.map((card) => ({ ...card, zone: 'library' }));
    game.libraries = new Map([[playerId, library.map((card) => ({ ...card }))]]);

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.state = game.state;
    ResolutionQueueManager.removeQueue(gameId);

    const step = {
      kind: 'scry',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 2 },
      raw: 'Scry 2.',
    } as const;

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'scry_spell_1',
      sourceName: 'Test Scry',
    });

    applyOracleIRStepsOnServer(ctx, game.state as any, [step], irCtx, { allowOptional: false }, { controller: playerId });

    const scryStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;
    expect(scryStep).toBeDefined();
    expect(scryStep.oracleIrChoiceStepJson).toBeTruthy();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(scryStep.id),
      selections: {
        keepTopOrder: ['top-2'],
        bottomOrder: ['top-1'],
      },
    });

    const lib = game.libraries.get(playerId).map((card: any) => card.id);
    expect(lib).toEqual(['top-2', 'top-1']);

    const resolvedEvent = [...getEvents(gameId)].reverse().find((event) => event.type === 'scryResolve') as any;
    expect(resolvedEvent).toBeDefined();
    expect(resolvedEvent.payload?.oracleIrAppliedStepKinds).toEqual([[0, 'scry']]);
    expect(Array.isArray(resolvedEvent.payload?.oracleIrStepLedger)).toBe(true);

    expect((game.state as any).oracleIrAppliedStepKinds?.get(0)).toBe('scry');

    const replayGame = createInitialGameState('test_oracle_ir_scry_socket_replay_apply');
    replayGame.applyEvent({ type: 'join', playerId, name: 'P1' });
    (replayGame.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: library.map((card) => ({ ...card, zone: 'library' })),
        libraryCount: library.length,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    (replayGame as any).libraries = new Map([
      [playerId, library.map((card) => ({ ...card, zone: 'library' }))],
    ]);

    replayGame.applyEvent({
      type: 'scryResolve',
      ...resolvedEvent.payload,
    });

    const replayLib = (replayGame as any).libraries.get(playerId).map((card: any) => card.id);
    expect(replayLib).toEqual(['top-2', 'top-1']);
    expect((replayGame.state as any).oracleIrAppliedStepKinds?.get(0)).toBe('scry');
  });
});
