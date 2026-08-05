import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import {
  applyOracleIRStepsOnServer,
  maybeApplyOracleIrChoiceStepFromResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

const searchCreatureOracle =
  'Search your library for a creature card, put it into your hand, then shuffle.';

function setupSearchGame(gameId: string, library: Array<Record<string, unknown>>) {
  const game = createInitialGameState(gameId);
  const p1 = 'p1' as PlayerID;

  game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

  (game.state as any).zones = {
    [p1]: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      libraryCount: library.length,
    },
  };

  const player = (game.state as any).players.find((entry: any) => entry.id === p1);
  player.hand = [];
  player.library = library.map((card) => ({ ...card, zone: 'library' }));

  const ctx = game as any;
  ctx.gameId = gameId;
  ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);
  ResolutionQueueManager.removeQueue(gameId);

  return { game, ctx, p1, player };
}

const searchCreatureStep = {
  kind: 'search_library',
  who: { kind: 'you' },
  criteria: { kind: 'raw', text: 'creature' },
  destination: 'hand',
  revealFound: false,
  shuffle: true,
  maxResults: 1,
  raw: searchCreatureOracle,
} as const;

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

async function resetSocketGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('oracle IR search_library queue adapter', () => {
  it('queues library search when multiple cards match and applies the chosen card on resume', () => {
    const { ctx, p1 } = setupSearchGame('oracle_ir_search_library_queue', [
      { id: 'creature-a', name: 'Elves', type_line: 'Creature — Elf' },
      { id: 'creature-b', name: 'Bears', type_line: 'Creature — Bear' },
      { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant' },
    ]);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'search-source-1',
      sourceName: 'Search Source',
    });

    applyOracleIRStepsOnServer(
      ctx,
      (ctx as any).state,
      [searchCreatureStep as any],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer((ctx as any).gameId, p1);
    const searchStep = steps.find((step) => step.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(searchStep).toBeTruthy();
    expect((searchStep as any)?.availableCards).toHaveLength(2);
    expect((searchStep as any)?.maxSelections).toBe(1);
    expect(String((searchStep as any)?.oracleIrChoiceStepJson || '')).toContain('search_library');

    const completedStep = ResolutionQueueManager.completeStep((ctx as any).gameId, String(searchStep!.id), {
      stepId: String(searchStep!.id),
      playerId: p1,
      selections: ['creature-b'],
      cancelled: false,
      timestamp: Date.now(),
    });

    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    expect(resumed?.appliedSteps?.some((step) => step.kind === 'search_library')).toBe(true);

    const playerAfter = (ctx as any).state.players.find((entry: any) => entry.id === p1);
    expect((playerAfter?.hand || []).map((card: any) => card.id)).toEqual(['creature-b']);
    const libraryIds = (ctx.libraries.get(p1) || []).map((card: any) => card.id);
    expect(libraryIds).toHaveLength(2);
    expect(libraryIds).toContain('creature-a');
    expect(libraryIds).toContain('bolt');
    expect(libraryIds).not.toContain('creature-b');
  });

  it('queues LIBRARY_SEARCH even when only one card matches (interactive tutors)', () => {
    const { ctx, p1 } = setupSearchGame('oracle_ir_search_library_single_match', [
      { id: 'creature-a', name: 'Elves', type_line: 'Creature — Elf' },
      { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant' },
    ]);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'search-source-2',
      sourceName: 'Search Source',
    });

    const result = applyOracleIRStepsOnServer(
      ctx,
      (ctx as any).state,
      [searchCreatureStep as any],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    expect(result.appliedSteps.map((step) => step.kind)).toEqual([]);
    expect(result.automationGaps?.some((gap: any) => gap.stepKind === 'search_library')).toBe(true);
    const steps = ResolutionQueueManager.getStepsForPlayer((ctx as any).gameId, p1);
    const searchStep = steps.find((step) => step.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    expect(searchStep).toBeTruthy();
    expect((searchStep.availableCards || []).map((card: any) => card.id)).toEqual(['creature-a']);

    const playerAfter = (ctx as any).state.players.find((entry: any) => entry.id === p1);
    expect((playerAfter?.hand || []).map((card: any) => card.id)).toEqual([]);
  });
});

describe('oracle IR search_library socket replay', () => {
  const gameId = 'test_oracle_ir_search_library_socket_replay';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetSocketGame(gameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetSocketGame(gameId);
  });

  it('persists librarySearchResolve when non-split IR library search resolves via socket', async () => {
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
        libraryCount: 3,
      },
    };
    (game as any).libraries = new Map([
      [playerId, [
        { id: 'creature-a', name: 'Elves', type_line: 'Creature — Elf', oracle_text: '', image_uris: { normal: 'elf.png' } },
        { id: 'creature-b', name: 'Bears', type_line: 'Creature — Bear', oracle_text: '', image_uris: { normal: 'bear.png' } },
        { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: '', image_uris: { normal: 'bolt.png' } },
      ]],
    ]);
    (game.state as any).stack = [
      {
        id: 'tutor_stack_1',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'tutor_1',
          name: 'Eladamri\'s Call',
          type_line: 'Instant',
          oracle_text: searchCreatureOracle,
          mana_cost: '{1}{G}{U}',
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
    expect(step.persistLibrarySearchResolve).toBe(true);
    expect(step.maxSelections).toBe(1);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: ['creature-b'],
    });

    expect((game.state as any).oracleIrStepLedger?.size).toBeGreaterThan(0);
    expect((game.state as any).oracleIrAppliedStepKinds?.get(0)).toBe('search_library');

    const resolvedEvent = [...getEvents(gameId)].reverse().find((event) => event.type === 'librarySearchResolve') as any;
    expect(resolvedEvent).toBeDefined();
    expect(Array.isArray(resolvedEvent.payload?.oracleIrStepLedger)).toBe(true);
    expect((resolvedEvent.payload?.oracleIrStepLedger || []).length).toBeGreaterThan(0);
    expect(resolvedEvent.payload?.oracleIrAppliedStepKinds).toEqual([[0, 'search_library']]);
    expect((resolvedEvent.payload?.selectedCardIds || [])).toEqual(['creature-b']);

    const liveZones = (game.state as any).zones?.[playerId];
    expect((liveZones?.hand || []).map((card: any) => card.id)).toEqual(['creature-b']);
    expect((game.state as any).oracleIrStepLedger?.size).toBeGreaterThan(0);

    const replayGame = createInitialGameState('test_oracle_ir_search_library_socket_replay_apply');
    replayGame.applyEvent({ type: 'join', playerId: playerId as PlayerID, name: 'P1' });
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
    expect((replayZones?.hand || []).map((card: any) => card.id)).toEqual(['creature-b']);
    expect((replayGame.state as any).oracleIrStepLedger?.size).toBeGreaterThan(0);
    expect((replayGame.state as any).oracleIrAppliedStepKinds?.get(0)).toBe('search_library');
  });
});
