import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
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

describe('oracle IR choose_pile end-to-end', () => {
  const gameId = 'oracle_ir_choose_pile_e2e';

  async function resetGame(id: string) {
    ResolutionQueueManager.removeQueue(id);
    games.delete(id as any);
    await deleteGame(id);
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('moves cards after top_library split and pile choice through resolution handlers', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];

    const library = [
      { id: 'c1', name: 'Card 1', zone: 'library' },
      { id: 'c2', name: 'Card 2', zone: 'library' },
      { id: 'c3', name: 'Card 3', zone: 'library' },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        library: library.map((card) => ({ ...card })),
        libraryCount: library.length,
        graveyard: [],
        graveyardCount: 0,
      },
      [p2]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    (game as any).libraries = new Map([[p1, library.map((card) => ({ ...card }))]]);
    (game as any).gameId = gameId;

    ResolutionQueueManager.removeQueue(gameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'split-spell-1',
      sourceName: 'Split Spell',
    });

    applyOracleIRStepsOnServer(
      game as any,
      game.state as any,
      [
        {
          kind: 'choose_pile',
          chooser: { kind: 'target_opponent' },
          source: 'top_library',
          chosenDestination: 'hand',
          otherDestination: 'graveyard',
          raw: 'Reveal the top three cards of your library and separate them into two piles.',
        } as any,
      ],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const splitStep = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .find((step) => step.type === ResolutionStepType.TWO_PILE_SPLIT);
    expect(splitStep).toBeTruthy();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const p2Socket = createMockSocket(p2, emitted, gameId);
    const p1Socket = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [p2Socket.socket, p1Socket.socket]);
    registerResolutionHandlers(io as any, p2Socket.socket as any);
    registerResolutionHandlers(io as any, p1Socket.socket as any);

    await p2Socket.handlers['submitResolutionResponse']({
      gameId,
      stepId: splitStep!.id,
      selections: { pileA: ['c1', 'c3'], pileB: ['c2'] },
    });

    const pileStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.OPTION_CHOICE);
    expect(pileStep).toBeTruthy();
    expect((pileStep as any)?.choosePileFromSplitChoice).toBe(true);
    expect((pileStep as any)?.choosePileFromSplitPileA).toEqual(['c1', 'c3']);
    expect((pileStep as any)?.choosePileFromSplitPileB).toEqual(['c2']);

    await p1Socket.handlers['submitResolutionResponse']({
      gameId,
      stepId: pileStep!.id,
      selections: 'pileA',
    });

    const handIds = ((game.state as any).zones[p1].hand || []).map((card: any) => card.id);
    const graveyardIds = ((game.state as any).zones[p1].graveyard || []).map((card: any) => card.id);
    expect(handIds).toEqual(['c1', 'c3']);
    expect(graveyardIds).toEqual(['c2']);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('queues opponent picker then split and pile choice with multiple opponents', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
      { id: p3, name: 'P3', spectator: false, life: 40 },
    ];

    const library = [
      { id: 'c1', name: 'Card 1', zone: 'library' },
      { id: 'c2', name: 'Card 2', zone: 'library' },
      { id: 'c3', name: 'Card 3', zone: 'library' },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        library: library.map((card) => ({ ...card })),
        libraryCount: library.length,
        graveyard: [],
        graveyardCount: 0,
      },
      [p2]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
      [p3]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    (game as any).libraries = new Map([[p1, library.map((card) => ({ ...card }))]]);
    (game as any).gameId = gameId;

    ResolutionQueueManager.removeQueue(gameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'split-spell-multi',
      sourceName: 'Multi Split Spell',
    });

    applyOracleIRStepsOnServer(
      game as any,
      game.state as any,
      [
        {
          kind: 'choose_pile',
          chooser: { kind: 'target_opponent' },
          source: 'top_library',
          chosenDestination: 'hand',
          otherDestination: 'graveyard',
          raw: 'Reveal the top three cards of your library and separate them into two piles.',
        } as any,
      ],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const opponentPickerStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.OPTION_CHOICE && (step as any).choosePlayerForTwoPileSplitChoice);
    expect(opponentPickerStep).toBeTruthy();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const p1Socket = createMockSocket(p1, emitted, gameId);
    const p2Socket = createMockSocket(p2, emitted, gameId);
    const p3Socket = createMockSocket(p3, emitted, gameId);
    const io = createMockIo(emitted, [p1Socket.socket, p2Socket.socket, p3Socket.socket]);
    registerResolutionHandlers(io as any, p1Socket.socket as any);
    registerResolutionHandlers(io as any, p2Socket.socket as any);
    registerResolutionHandlers(io as any, p3Socket.socket as any);

    await p1Socket.handlers['submitResolutionResponse']({
      gameId,
      stepId: opponentPickerStep!.id,
      selections: p2,
    });

    const splitStep = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .find((step) => step.type === ResolutionStepType.TWO_PILE_SPLIT);
    expect(splitStep).toBeTruthy();

    await p2Socket.handlers['submitResolutionResponse']({
      gameId,
      stepId: splitStep!.id,
      selections: { pileA: ['c1'], pileB: ['c2', 'c3'] },
    });

    const pileStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.OPTION_CHOICE && (step as any).choosePileFromSplitChoice);
    expect(pileStep).toBeTruthy();

    await p1Socket.handlers['submitResolutionResponse']({
      gameId,
      stepId: pileStep!.id,
      selections: 'pileB',
    });

    const handIds = ((game.state as any).zones[p1].hand || []).map((card: any) => card.id);
    const graveyardIds = ((game.state as any).zones[p1].graveyard || []).map((card: any) => card.id);
    expect(handIds).toEqual(['c2', 'c3']);
    expect(graveyardIds).toEqual(['c1']);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });
});
