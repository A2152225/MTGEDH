import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { evaluateConditionalWrapperCondition } from '../../rules-engine/src/oracleIRExecutorConditionalStepSupport.js';
import { isSearchedLibraryThisWayLedgerFirst } from '../../rules-engine/src/oracleIRLedgerCardAccess.js';
import { assertNoReplayDivergence, toReplayEvents } from './helpers/replayDivergence.js';
import { createInitialGameState } from '../src/state/index.js';
import {
  readAppliedStepKindsFromState,
  readStepLedgerFromState,
} from '../src/state/modules/oracleIrTransitionPipeline.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe("Kodama's Reach Oracle IR library search", () => {
  const gameId = 'test_kodama_reach_oracle_ir_library_search';
  const playerId = 'p1';
  const oracleText =
    "Search your library for up to two basic land cards, put one onto the battlefield tapped and the other into your hand, then shuffle.";

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetGame(gameId);
  });

  it('queues a single split-destination library search under Oracle IR spell primary', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

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
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 6,
      },
    };
    (game as any).libraries = new Map([
      [playerId, [
        { id: 'f1', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', image_uris: { normal: 'forest.png' } },
        { id: 'f2', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', image_uris: { normal: 'forest2.png' } },
        { id: 'p1', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '', image_uris: { normal: 'plains.png' } },
        { id: 'p2', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '', image_uris: { normal: 'plains2.png' } },
        { id: 'island', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '', image_uris: { normal: 'island.png' } },
        { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: '', image_uris: { normal: 'bolt.png' } },
      ]],
    ]);
    (game.state as any).stack = [
      {
        id: 'kodamas_reach_stack_1',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'kodamas_reach_1',
          name: "Kodama's Reach",
          type_line: 'Sorcery',
          oracle_text: oracleText,
          mana_cost: '{2}{G}',
        },
        targets: [],
      },
    ];

    resolveTopOfStack(game as any);

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).filter(
      (entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH,
    ) as any[];
    expect(steps).toHaveLength(1);
    expect(steps[0].splitDestination).toBe(true);
    expect(steps[0].destination).toBe('split');
    expect(steps[0].maxSelections).toBe(2);
    expect(steps[0].oracleIrChoiceStepJson).toBeTruthy();
    expect(steps[0].filter).toEqual({ supertypes: ['basic'], types: ['land'] });
    expect((steps[0].availableCards || []).map((card: any) => card.id)).toEqual([
      'f1', 'f2', 'p1', 'p2', 'island',
    ]);
  });

  it('resolves split library search via Oracle IR resume and updates zones', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

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
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 4,
      },
    };
    (game as any).libraries = new Map([
      [playerId, [
        { id: 'f1', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', image_uris: { normal: 'forest.png' } },
        { id: 'p1', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '', image_uris: { normal: 'plains.png' } },
        { id: 'island', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '', image_uris: { normal: 'island.png' } },
        { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: '', image_uris: { normal: 'bolt.png' } },
      ]],
    ]);
    (game.state as any).stack = [
      {
        id: 'kodamas_reach_stack_2',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'kodamas_reach_2',
          name: "Kodama's Reach",
          type_line: 'Sorcery',
          oracle_text: oracleText,
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

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH,
    ) as any;
    expect(step).toBeDefined();
    expect(step.oracleIrChoiceStepJson).toBeTruthy();

    const eventStart = getEvents(gameId).length;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: ['f1', 'p1'],
      splitAssignments: {
        toBattlefield: ['f1'],
        toHand: ['p1'],
      },
    });

    const liveZones = (game.state as any).zones?.[playerId];
    const liveBattlefield = (game.state as any).battlefield || [];
    expect((liveZones?.hand || []).map((card: any) => card.id)).toEqual(['p1']);
    expect(liveBattlefield.some((permanent: any) => permanent?.card?.id === 'f1' && permanent?.tapped === true)).toBe(true);
    expect((game.state as any).oracleIrStepLedger?.size).toBeGreaterThan(0);

    const liveIrCtx = buildOracleIRExecutionContext({
      controllerId: playerId as PlayerID,
      sourceId: 'kodamas_reach_2',
      sourceName: "Kodama's Reach",
      stepLedger: readStepLedgerFromState(game.state),
      appliedStepKinds: readAppliedStepKindsFromState(game.state),
      currentStepIndex: 1,
    });
    const searchedConditionalStep = {
      kind: 'conditional',
      raw: 'If you searched your library this way, draw a card.',
      condition: { kind: 'if', raw: 'you searched your library this way' },
      thisWayAntecedentStepIndex: 0,
      thisWayAntecedentStepKind: 'search_library',
    } as const;
    expect(isSearchedLibraryThisWayLedgerFirst(liveIrCtx, searchedConditionalStep as any)).toBe(true);
    expect(evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: 'you searched your library this way' },
      nextState: game.state as any,
      controllerId: playerId as PlayerID,
      ctx: liveIrCtx,
      lastActionOutcome: { kind: 'applied', stepKind: 'shuffle_library' },
      step: searchedConditionalStep as any,
    })).toBe(true);

    const resolvedEvent = [...getEvents(gameId)].reverse().find((event) => event.type === 'librarySearchResolve') as any;
    expect(resolvedEvent).toBeDefined();
    expect(Array.isArray(resolvedEvent.payload?.oracleIrStepLedger)).toBe(true);
    expect((resolvedEvent.payload?.oracleIrStepLedger || []).length).toBeGreaterThan(0);
    expect(resolvedEvent.payload?.oracleIrAppliedStepKinds?.some((entry: [number, string]) => entry[1] === 'search_library')).toBe(true);
    expect(resolvedEvent.payload?.splitAssignments).toEqual({
      toBattlefield: ['f1'],
      toHand: ['p1'],
    });
    expect((resolvedEvent.payload?.selectedCardIds || [])).toEqual(['f1', 'p1']);

    const replayGameId = `${gameId}_replay_divergence`;
    const replayGame = createInitialGameState(replayGameId);
    (replayGame as any).gameId = replayGameId;
    (replayGame.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (replayGame.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 4,
      },
    };
    (replayGame as any).libraries = new Map([
      [playerId, [
        { id: 'f1', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', image_uris: { normal: 'forest.png' } },
        { id: 'p1', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '', image_uris: { normal: 'plains.png' } },
        { id: 'island', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '', image_uris: { normal: 'island.png' } },
        { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: '', image_uris: { normal: 'bolt.png' } },
      ]],
    ]);
    (replayGame.state as any).stack = [
      {
        id: 'kodamas_reach_stack_2',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'kodamas_reach_2',
          name: "Kodama's Reach",
          type_line: 'Sorcery',
          oracle_text: oracleText,
          mana_cost: '{2}{G}',
        },
        targets: [],
      },
    ];
    replayGame.replay(toReplayEvents(gameId, eventStart) as any);
    assertNoReplayDivergence(game, replayGame);

    const shuffleEvent = [...getEvents(gameId)].reverse().find((event) => event.type === 'shuffleLibrary') as any;
    expect(shuffleEvent).toBeDefined();
    expect(Array.isArray(shuffleEvent.payload?.shuffledLibraryIds)).toBe(true);
    expect(shuffleEvent.payload?.shuffledLibraryIds.length).toBeGreaterThan(0);
  });
});
