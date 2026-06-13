import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { evaluateModifyPtWhereX } from '../../rules-engine/src/oracleIRExecutorModifyPtWhereEvaluator.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  readAppliedStepKindsFromState,
  readStepLedgerFromState,
} from '../src/state/modules/oracleIrTransitionPipeline.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler, processPendingOracleIrCompoundResume } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import {
  applyOracleIRStepsOnServer,
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
  resumeOracleIrPendingCompoundStepsFromState,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import '../src/state/modules/priority.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

async function resetSocketGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function setupStackSpellLibraryGame(
  game: ReturnType<typeof createInitialGameState>,
  gameId: string,
  library: Array<Record<string, unknown>>,
) {
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
}

function queueStackSpell(
  game: ReturnType<typeof createInitialGameState>,
  card: {
    id: string;
    name: string;
    type_line: string;
    oracle_text: string;
    mana_cost: string;
  },
  stackId: string,
) {
  (game.state as any).stack = [
    {
      id: stackId,
      type: 'spell',
      controller: playerId,
      card,
      targets: [],
    },
  ];
}

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

describe('oracle IR scry compound resume', () => {
  it('resumes draw after scry choice via IR compound continuation', () => {
    const localGameId = 'oracle_ir_scry_then_draw_compound';
    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest' },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island' },
    ];
    const { game, ctx, player } = setupLibraryGame(localGameId, library);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'opt-1',
      sourceName: 'Opt',
    });

    const firstPass = applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [
        {
          kind: 'scry',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          raw: 'Scry 1.',
        },
        {
          kind: 'draw',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          raw: 'Draw a card.',
        },
      ] as any,
      irCtx,
      { allowOptional: false },
      { controller: playerId },
    );

    expect(firstPass.pendingContinuationSteps?.map((step) => step.kind)).toEqual(['draw']);
    expect(firstPass.appliedSteps.map((step) => step.kind)).toEqual([]);

    const scryStep = ResolutionQueueManager.getStepsForPlayer(localGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;
    expect(scryStep).toBeTruthy();
    expect(String(scryStep.oracleIrResumeStepsJson || '')).toContain('draw');

    game.applyEvent!({
      type: 'scryResolve',
      playerId,
      keepTopOrder: [],
      bottomOrder: ['top-1'],
    } as any);

    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, scryStep, {
      selections: {
        keepTopOrder: [],
        bottomOrder: ['top-1'],
      },
    });
    expect(resumed?.appliedSteps.map((step) => step.kind)).toEqual(['scry']);

    maybeResumeOracleIRStepsAfterResolution(ctx, scryStep);

    expect(player.hand.map((card: any) => card.id)).toEqual(['draw-me']);
    expect(player.library.map((card: any) => card.id)).toEqual(['top-1']);
  });

  it('resumes draw after IR-bridged scry resolves via socket', async () => {
    initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    const localGameId = 'oracle_ir_scry_draw_socket_compound';
    await resetSocketGame(localGameId);

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(localGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(localGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = localGameId;

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
    ctx.gameId = localGameId;
    ctx.state = game.state;
    ResolutionQueueManager.removeQueue(localGameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'opt_socket_1',
      sourceName: 'Opt',
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [
        {
          kind: 'scry',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          raw: 'Scry 1.',
        },
        {
          kind: 'draw',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          raw: 'Draw a card.',
        },
      ] as any,
      irCtx,
      { allowOptional: false },
      { controller: playerId },
    );

    const scryStep = ResolutionQueueManager.getStepsForPlayer(localGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;
    expect(scryStep).toBeDefined();
    expect(String(scryStep.oracleIrResumeStepsJson || '')).toContain('draw');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, localGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId: localGameId,
      stepId: String(scryStep.id),
      selections: {
        keepTopOrder: [],
        bottomOrder: ['top-1'],
      },
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.hand || []).map((card: any) => card.id)).toEqual(['draw-me']);
    expect(game.libraries.get(playerId).map((card: any) => card.id)).toEqual(['top-1']);
    expect(ResolutionQueueManager.getStepsForPlayer(localGameId, playerId)).toHaveLength(0);

    const drawEvent = [...getEvents(localGameId)].reverse()
      .find((event) => event.type === 'drawCards' && event.payload?.oracleIrCompoundResume === true) as any;
    expect(drawEvent).toBeDefined();
    expect(drawEvent.payload?.count).toBe(1);
    expect(drawEvent.payload?.drawnCardIds).toEqual(['draw-me']);

    await resetSocketGame(localGameId);
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

describe('oracle IR Opt stack resolve E2E', () => {
  const gameId = 'test_oracle_ir_opt_stack_resolve';
  const considerGameId = 'test_oracle_ir_consider_stack_resolve';
  const optLedgerGameId = 'test_oracle_ir_opt_stack_ledger_replay';
  const considerLedgerGameId = 'test_oracle_ir_consider_stack_ledger_replay';
  const optCompoundReconnectGameId = 'test_oracle_ir_opt_compound_reconnect';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetSocketGame(gameId);
    await resetSocketGame(considerGameId);
    await resetSocketGame(optLedgerGameId);
    await resetSocketGame(considerLedgerGameId);
    await resetSocketGame(optCompoundReconnectGameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetSocketGame(gameId);
    await resetSocketGame(considerGameId);
    await resetSocketGame(optLedgerGameId);
    await resetSocketGame(considerLedgerGameId);
    await resetSocketGame(optCompoundReconnectGameId);
  });

  it('resolveTopOfStack queues IR scry for Opt then socket response completes the draw', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, gameId, library);
    queueStackSpell(game, {
      id: 'opt_1',
      name: 'Opt',
      type_line: 'Instant',
      oracle_text: 'Scry 1. Draw a card.',
      mana_cost: '{U}',
    }, 'opt_stack_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const scryStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;
    expect(scryStep).toBeDefined();
    expect(scryStep.scryCount).toBe(1);
    expect(String(scryStep.oracleIrChoiceStepJson || '')).toContain('scry');
    expect(String(scryStep.oracleIrResumeStepsJson || '')).toContain('draw');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(scryStep.id),
      selections: {
        keepTopOrder: [],
        bottomOrder: ['top-1'],
      },
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.hand || []).map((card: any) => card.id)).toEqual(['draw-me']);
    expect(game.libraries.get(playerId).map((card: any) => card.id)).toEqual(['top-1']);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, playerId)).toHaveLength(0);
    expect((game.state as any).stack || []).toHaveLength(0);
  });

  it('resolveTopOfStack queues IR surveil for Consider then socket response completes the draw', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(considerGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(considerGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, considerGameId, library);
    queueStackSpell(game, {
      id: 'consider_1',
      name: 'Consider',
      type_line: 'Instant',
      oracle_text: 'Surveil 1. Draw a card.',
      mana_cost: '{U}',
    }, 'consider_stack_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, considerGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const surveilStep = ResolutionQueueManager.getStepsForPlayer(considerGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SURVEIL) as any;
    expect(surveilStep).toBeDefined();
    expect(surveilStep.surveilCount).toBe(1);
    expect(String(surveilStep.oracleIrChoiceStepJson || '')).toContain('surveil');
    expect(String(surveilStep.oracleIrResumeStepsJson || '')).toContain('draw');

    await handlers['submitResolutionResponse']({
      gameId: considerGameId,
      stepId: String(surveilStep.id),
      selections: {
        keepTopOrder: [],
        toGraveyard: ['top-1'],
      },
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.hand || []).map((card: any) => card.id)).toEqual(['draw-me']);
    expect(game.libraries.get(playerId).map((card: any) => card.id)).toEqual([]);
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual(['consider_1', 'top-1']);
    expect(ResolutionQueueManager.getStepsForPlayer(considerGameId, playerId)).toHaveLength(0);
    expect((game.state as any).stack || []).toHaveLength(0);
  });

  it('persists scryResolve ledger through Opt stack resolve and replays scry-this-way reads', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(optLedgerGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(optLedgerGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, optLedgerGameId, library);
    queueStackSpell(game, {
      id: 'opt_ledger_1',
      name: 'Opt',
      type_line: 'Instant',
      oracle_text: 'Scry 1. Draw a card.',
      mana_cost: '{U}',
    }, 'opt_stack_ledger_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, optLedgerGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const scryStep = ResolutionQueueManager.getStepsForPlayer(optLedgerGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;
    expect(scryStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: optLedgerGameId,
      stepId: String(scryStep.id),
      selections: {
        keepTopOrder: [],
        bottomOrder: ['top-1'],
      },
    });

    expect((game.state as any).oracleIrAppliedStepKinds?.get(0)).toBe('scry');

    const resolvedEvent = [...getEvents(optLedgerGameId)].reverse().find((event) => event.type === 'scryResolve') as any;
    expect(resolvedEvent).toBeDefined();
    expect(resolvedEvent.payload?.oracleIrAppliedStepKinds).toEqual([[0, 'scry']]);
    expect(Array.isArray(resolvedEvent.payload?.oracleIrStepLedger)).toBe(true);

    const scryWhereStep = {
      kind: 'modify_pt',
      raw: 'where X is the number of cards looked at while scrying this way',
      thisWayAntecedentStepIndex: 0,
      thisWayAntecedentStepKind: 'scry',
    } as const;
    const liveIrCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'opt_ledger_1',
      sourceName: 'Opt',
      stepLedger: readStepLedgerFromState(game.state),
      appliedStepKinds: readAppliedStepKindsFromState(game.state),
      currentStepIndex: 1,
    });
    expect(evaluateModifyPtWhereX(
      game.state as any,
      playerId,
      'X is the number of cards looked at while scrying this way',
      undefined,
      liveIrCtx,
      undefined,
      0,
      scryWhereStep as any,
    )).toBe(1);

    const replayGame = createInitialGameState('test_oracle_ir_opt_stack_ledger_replay_apply');
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

    expect((replayGame.state as any).oracleIrAppliedStepKinds?.get(0)).toBe('scry');
    const replayIrCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'opt_ledger_1',
      sourceName: 'Opt',
      stepLedger: readStepLedgerFromState(replayGame.state),
      appliedStepKinds: readAppliedStepKindsFromState(replayGame.state),
      currentStepIndex: 1,
    });
    expect(evaluateModifyPtWhereX(
      replayGame.state as any,
      playerId,
      'X is the number of cards looked at while scrying this way',
      undefined,
      replayIrCtx,
      undefined,
      0,
      scryWhereStep as any,
    )).toBe(1);
  });

  it('persists surveilResolve ledger through Consider stack resolve and replays revealed-this-way reads', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(considerLedgerGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(considerLedgerGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, considerLedgerGameId, library);
    queueStackSpell(game, {
      id: 'consider_ledger_1',
      name: 'Consider',
      type_line: 'Instant',
      oracle_text: 'Surveil 1. Draw a card.',
      mana_cost: '{U}',
    }, 'consider_stack_ledger_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, considerLedgerGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const surveilStep = ResolutionQueueManager.getStepsForPlayer(considerLedgerGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SURVEIL) as any;
    expect(surveilStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: considerLedgerGameId,
      stepId: String(surveilStep.id),
      selections: {
        keepTopOrder: [],
        toGraveyard: ['top-1'],
      },
    });

    expect((game.state as any).oracleIrAppliedStepKinds?.get(0)).toBe('surveil');

    const resolvedEvent = [...getEvents(considerLedgerGameId)].reverse()
      .find((event) => event.type === 'surveilResolve') as any;
    expect(resolvedEvent).toBeDefined();
    expect(resolvedEvent.payload?.oracleIrAppliedStepKinds).toEqual([[0, 'surveil']]);
    expect(Array.isArray(resolvedEvent.payload?.oracleIrStepLedger)).toBe(true);
    expect(String(resolvedEvent.payload?.oracleIrResumeStepsJson || '')).toContain('draw');

    const revealedWhereStep = {
      kind: 'modify_pt',
      raw: 'where X is the number of cards revealed this way',
      thisWayAntecedentStepIndex: 0,
      thisWayAntecedentStepKind: 'surveil',
    } as const;

    const replayGame = createInitialGameState('test_oracle_ir_consider_stack_ledger_replay_apply');
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
      type: 'surveilResolve',
      ...resolvedEvent.payload,
    });

    expect((replayGame.state as any).oracleIrAppliedStepKinds?.get(0)).toBe('surveil');
    expect((replayGame.state as any).zones?.[playerId]?.graveyard?.map((card: any) => card.id)).toEqual(['top-1']);
    expect((replayGame as any).libraries.get(playerId).map((card: any) => card.id)).toEqual(['draw-me']);
    expect(String((replayGame.state as any).oracleIrPendingResumeStepsJson || '')).toContain('draw');

    const replayIrCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'consider_ledger_1',
      sourceName: 'Consider',
      stepLedger: readStepLedgerFromState(replayGame.state),
      appliedStepKinds: readAppliedStepKindsFromState(replayGame.state),
      currentStepIndex: 1,
    });
    expect(evaluateModifyPtWhereX(
      replayGame.state as any,
      playerId,
      'X is the number of cards revealed this way',
      undefined,
      replayIrCtx,
      undefined,
      0,
      revealedWhereStep as any,
    )).toBe(1);
  });

  it('persists oracleIrResumeStepsJson on Opt scryResolve and replays compound draw after reconnect', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(optCompoundReconnectGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(optCompoundReconnectGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, optCompoundReconnectGameId, library);
    queueStackSpell(game, {
      id: 'opt_reconnect_1',
      name: 'Opt',
      type_line: 'Instant',
      oracle_text: 'Scry 1. Draw a card.',
      mana_cost: '{U}',
    }, 'opt_stack_reconnect_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, optCompoundReconnectGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const scryStep = ResolutionQueueManager.getStepsForPlayer(optCompoundReconnectGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;
    expect(scryStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: optCompoundReconnectGameId,
      stepId: String(scryStep.id),
      selections: {
        keepTopOrder: [],
        bottomOrder: ['top-1'],
      },
    });

    const resolvedEvent = [...getEvents(optCompoundReconnectGameId)].reverse()
      .find((event) => event.type === 'scryResolve') as any;
    expect(resolvedEvent).toBeDefined();
    expect(String(resolvedEvent.payload?.oracleIrResumeStepsJson || '')).toContain('draw');
    expect(resolvedEvent.payload?.oracleIrControllerId).toBe(playerId);
    expect(resolvedEvent.payload?.oracleIrSourceName).toBe('Opt');

    const replayGame = createInitialGameState('test_oracle_ir_opt_compound_reconnect_apply');
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

    const replayPlayer = (replayGame.state as any).players.find((entry: any) => entry.id === playerId);
    expect((replayGame.state as any).zones?.[playerId]?.hand || []).toHaveLength(0);
    expect((replayGame as any).libraries.get(playerId).map((card: any) => card.id)).toEqual(['draw-me', 'top-1']);
    expect(String((replayGame.state as any).oracleIrPendingResumeStepsJson || '')).toContain('draw');

    const replayCtx = replayGame as any;
    replayCtx.gameId = 'test_oracle_ir_opt_compound_reconnect_apply';
    replayCtx.state = replayGame.state;
    replayCtx.libraries = (replayGame as any).libraries;

    const resumed = resumeOracleIrPendingCompoundStepsFromState(replayCtx);
    expect(resumed?.appliedSteps.map((step) => step.kind)).toEqual(['draw']);
    expect((replayGame.state as any).zones?.[playerId]?.hand?.map((card: any) => card.id)).toEqual(['draw-me']);
    expect((replayGame as any).libraries.get(playerId).map((card: any) => card.id)).toEqual(['top-1']);
    expect(replayPlayer.hand.map((card: any) => card.id)).toEqual(['draw-me']);
    expect((replayGame.state as any).oracleIrPendingResumeStepsJson).toBeUndefined();
  });

  it('replay auto-resumes Opt compound draw after scryResolve event', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(optCompoundReconnectGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(optCompoundReconnectGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, optCompoundReconnectGameId, library);
    queueStackSpell(game, {
      id: 'opt_replay_auto_1',
      name: 'Opt',
      type_line: 'Instant',
      oracle_text: 'Scry 1. Draw a card.',
      mana_cost: '{U}',
    }, 'opt_stack_replay_auto_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, optCompoundReconnectGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const scryStep = ResolutionQueueManager.getStepsForPlayer(optCompoundReconnectGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;
    expect(scryStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: optCompoundReconnectGameId,
      stepId: String(scryStep.id),
      selections: {
        keepTopOrder: [],
        bottomOrder: ['top-1'],
      },
    });

    const resolvedEvent = [...getEvents(optCompoundReconnectGameId)].reverse()
      .find((event) => event.type === 'scryResolve') as any;
    expect(resolvedEvent).toBeDefined();

    const replayGame = createInitialGameState('test_oracle_ir_opt_replay_auto_compound');
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

    replayGame.replay([{
      type: 'scryResolve',
      ...resolvedEvent.payload,
    }]);

    expect((replayGame.state as any).zones?.[playerId]?.hand?.map((card: any) => card.id)).toEqual(['draw-me']);
    expect((replayGame as any).libraries.get(playerId).map((card: any) => card.id)).toEqual(['top-1']);
    expect((replayGame.state as any).oracleIrPendingResumeStepsJson).toBeUndefined();
  });

  it('processPendingOracleIrCompoundResume completes Consider compound draw after surveilResolve replay', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const considerCompoundReconnectGameId = 'test_oracle_ir_consider_compound_reconnect';
    await resetSocketGame(considerCompoundReconnectGameId);

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(considerCompoundReconnectGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(considerCompoundReconnectGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, considerCompoundReconnectGameId, library);
    queueStackSpell(game, {
      id: 'consider_reconnect_1',
      name: 'Consider',
      type_line: 'Instant',
      oracle_text: 'Surveil 1. Draw a card.',
      mana_cost: '{U}',
    }, 'consider_stack_reconnect_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, considerCompoundReconnectGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const surveilStep = ResolutionQueueManager.getStepsForPlayer(considerCompoundReconnectGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SURVEIL) as any;
    expect(surveilStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: considerCompoundReconnectGameId,
      stepId: String(surveilStep.id),
      selections: {
        keepTopOrder: [],
        toGraveyard: ['top-1'],
      },
    });

    const resolvedEvent = [...getEvents(considerCompoundReconnectGameId)].reverse()
      .find((event) => event.type === 'surveilResolve') as any;
    expect(resolvedEvent).toBeDefined();
    expect(String(resolvedEvent.payload?.oracleIrResumeStepsJson || '')).toContain('draw');

    const replayGame = createInitialGameState('test_oracle_ir_consider_compound_reconnect_apply');
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
      type: 'surveilResolve',
      ...resolvedEvent.payload,
    });

    expect((replayGame.state as any).zones?.[playerId]?.hand || []).toHaveLength(0);
    expect((replayGame as any).libraries.get(playerId).map((card: any) => card.id)).toEqual(['draw-me']);
    expect(String((replayGame.state as any).oracleIrPendingResumeStepsJson || '')).toContain('draw');

    const replayCtx = replayGame as any;
    replayCtx.gameId = considerCompoundReconnectGameId;
    replayCtx.state = replayGame.state;
    replayCtx.libraries = (replayGame as any).libraries;

    processPendingOracleIrCompoundResume(io as any, replayCtx, considerCompoundReconnectGameId);

    const drawEvent = [...getEvents(considerCompoundReconnectGameId)].reverse()
      .find((event) => event.type === 'drawCards') as any;
    expect(drawEvent).toBeDefined();
    expect(drawEvent.payload?.oracleIrCompoundResume).toBe(true);
    expect(drawEvent.payload?.count).toBe(1);

    expect((replayGame.state as any).zones?.[playerId]?.hand?.map((card: any) => card.id)).toEqual(['draw-me']);
    expect((replayGame as any).libraries.get(playerId).map((card: any) => card.id)).toEqual([]);
    expect((replayGame.state as any).oracleIrPendingResumeStepsJson).toBeUndefined();

    await resetSocketGame(considerCompoundReconnectGameId);
  });

  it('replay auto-resume appends drawCards for event-log determinism', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const appendGameId = 'test_oracle_ir_opt_compound_draw_append';
    await resetSocketGame(appendGameId);

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(appendGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(appendGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, appendGameId, library);
    queueStackSpell(game, {
      id: 'opt_append_1',
      name: 'Opt',
      type_line: 'Instant',
      oracle_text: 'Scry 1. Draw a card.',
      mana_cost: '{U}',
    }, 'opt_stack_append_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, appendGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const scryStep = ResolutionQueueManager.getStepsForPlayer(appendGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;
    await handlers['submitResolutionResponse']({
      gameId: appendGameId,
      stepId: String(scryStep.id),
      selections: { keepTopOrder: [], bottomOrder: ['top-1'] },
    });

    const scryResolveEvent = [...getEvents(appendGameId)].reverse()
      .find((event) => event.type === 'scryResolve') as any;
    expect(scryResolveEvent).toBeDefined();

    const eventsBefore = getEvents(appendGameId).length;

    const replayGame = createInitialGameState(appendGameId);
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

    replayGame.replay([{ type: 'scryResolve', ...scryResolveEvent.payload }]);

    const drawEvent = [...getEvents(appendGameId)].reverse()
      .find((event) => event.type === 'drawCards') as any;
    expect(drawEvent).toBeDefined();
    expect(drawEvent.payload?.oracleIrCompoundResume).toBe(true);
    expect(drawEvent.payload?.count).toBe(1);
    expect(getEvents(appendGameId).length).toBeGreaterThan(eventsBefore);
    expect((replayGame.state as any).zones?.[playerId]?.hand?.map((card: any) => card.id)).toEqual(['draw-me']);

    await resetSocketGame(appendGameId);
  });

  it('replay with scryResolve and drawCards does not double-draw compound spells', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    const replayGame = createInitialGameState('test_oracle_ir_compound_no_double_draw');
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

    replayGame.replay([
      {
        type: 'scryResolve',
        playerId,
        keepTopOrder: [],
        bottomOrder: ['top-1'],
        oracleIrResumeStepsJson: JSON.stringify([{
          kind: 'draw',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          raw: 'Draw a card.',
        }]),
        oracleIrControllerId: playerId,
        oracleIrSourceId: 'opt_replay_1',
        oracleIrSourceName: 'Opt',
      },
      {
        type: 'drawCards',
        playerId,
        count: 1,
        oracleIrCompoundResume: true,
        oracleIrSourceId: 'opt_replay_1',
        oracleIrSourceName: 'Opt',
      },
    ]);

    expect((replayGame.state as any).zones?.[playerId]?.hand?.map((card: any) => card.id)).toEqual(['draw-me']);
    expect((replayGame as any).libraries.get(playerId).map((card: any) => card.id)).toEqual(['top-1']);
    expect((replayGame.state as any).oracleIrPendingResumeStepsJson).toBeUndefined();
  });

  it('replay drawCards with drawnCardIds draws by id regardless of library order', async () => {
    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest' },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island' },
    ];

    const replayGame = createInitialGameState('test_oracle_ir_drawn_card_ids_replay');
    replayGame.applyEvent({ type: 'join', playerId, name: 'P1' });
    (replayGame.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [...library].reverse().map((card) => ({ ...card, zone: 'library' })),
        libraryCount: library.length,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    (replayGame as any).libraries = new Map([
      [playerId, [...library].reverse().map((card) => ({ ...card, zone: 'library' }))],
    ]);

    replayGame.replay([
      {
        type: 'scryResolve',
        playerId,
        keepTopOrder: [],
        bottomOrder: ['top-1'],
        oracleIrResumeStepsJson: JSON.stringify([{
          kind: 'draw',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          raw: 'Draw a card.',
        }]),
        oracleIrControllerId: playerId,
        oracleIrSourceId: 'opt_replay_ids',
        oracleIrSourceName: 'Opt',
      },
      {
        type: 'drawCards',
        playerId,
        count: 1,
        drawnCardIds: ['draw-me'],
        oracleIrCompoundResume: true,
        oracleIrSourceId: 'opt_replay_ids',
        oracleIrSourceName: 'Opt',
      },
    ]);

    expect((replayGame.state as any).zones?.[playerId]?.hand?.map((card: any) => card.id)).toEqual(['draw-me']);
    expect((replayGame as any).libraries.get(playerId).map((card: any) => card.id)).toEqual(['top-1']);
  });

  it('trigger compound scry socket persists scryResolve and replays via drawCards', async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;

    const triggerGameId = 'test_oracle_ir_trigger_scry_draw_socket';
    await resetSocketGame(triggerGameId);

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(triggerGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(triggerGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = triggerGameId;
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
    ctx.gameId = triggerGameId;
    ctx.state = game.state;
    ResolutionQueueManager.removeQueue(triggerGameId);

    executeTriggerEffect(ctx, playerId, 'Opt', 'Scry 1. Draw a card.', {
      type: 'triggered_ability',
      controller: playerId,
      sourceId: 'opt_trigger_source',
      id: 'opt_trigger_compound_socket',
    });

    const scryStep = ResolutionQueueManager.getStepsForPlayer(triggerGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;
    expect(scryStep).toBeDefined();
    expect(String(scryStep.oracleIrResumeStepsJson || '')).toContain('draw');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, triggerGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId: triggerGameId,
      stepId: String(scryStep.id),
      selections: {
        keepTopOrder: [],
        bottomOrder: ['top-1'],
      },
    });

    expect((game.state as any).zones?.[playerId]?.hand?.map((card: any) => card.id)).toEqual(['draw-me']);

    const scryResolveEvent = [...getEvents(triggerGameId)].reverse()
      .find((event) => event.type === 'scryResolve') as any;
    expect(scryResolveEvent).toBeDefined();
    expect(String(scryResolveEvent.payload?.oracleIrResumeStepsJson || '')).toContain('draw');

    const replayGame = createInitialGameState(triggerGameId);
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

    replayGame.replay([{ type: 'scryResolve', ...scryResolveEvent.payload }]);

    expect((replayGame.state as any).zones?.[playerId]?.hand?.map((card: any) => card.id)).toEqual(['draw-me']);
    const drawEvent = [...getEvents(triggerGameId)].reverse()
      .find((event) => event.type === 'drawCards' && event.payload?.oracleIrCompoundResume === true);
    expect(drawEvent).toBeDefined();
    expect(drawEvent?.payload?.drawnCardIds).toEqual(['draw-me']);

    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    await resetSocketGame(triggerGameId);
  });

  it('trigger compound surveil socket persists surveilResolve and drawCards with drawnCardIds', async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;

    const triggerGameId = 'test_oracle_ir_trigger_surveil_draw_socket';
    await resetSocketGame(triggerGameId);

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(triggerGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(triggerGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = triggerGameId;
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
    ctx.gameId = triggerGameId;
    ctx.state = game.state;
    ResolutionQueueManager.removeQueue(triggerGameId);

    executeTriggerEffect(ctx, playerId, 'Consider', 'Surveil 1. Draw a card.', {
      type: 'triggered_ability',
      controller: playerId,
      sourceId: 'consider_trigger_source',
      id: 'consider_trigger_compound_socket',
    });

    const surveilStep = ResolutionQueueManager.getStepsForPlayer(triggerGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SURVEIL) as any;
    expect(surveilStep).toBeDefined();
    expect(String(surveilStep.oracleIrResumeStepsJson || '')).toContain('draw');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, triggerGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId: triggerGameId,
      stepId: String(surveilStep.id),
      selections: {
        keepTopOrder: [],
        toGraveyard: ['top-1'],
      },
    });

    expect((game.state as any).zones?.[playerId]?.hand?.map((card: any) => card.id)).toEqual(['draw-me']);
    expect((game.state as any).zones?.[playerId]?.graveyard?.map((card: any) => card.id)).toEqual(['top-1']);

    const surveilResolveEvent = [...getEvents(triggerGameId)].reverse()
      .find((event) => event.type === 'surveilResolve') as any;
    expect(surveilResolveEvent).toBeDefined();
    expect(String(surveilResolveEvent.payload?.oracleIrResumeStepsJson || '')).toContain('draw');

    const drawEvent = [...getEvents(triggerGameId)].reverse()
      .find((event) => event.type === 'drawCards' && event.payload?.oracleIrCompoundResume === true);
    expect(drawEvent).toBeDefined();
    expect(drawEvent?.payload?.drawnCardIds).toEqual(['draw-me']);

    const replayGame = createInitialGameState(triggerGameId);
    replayGame.applyEvent({ type: 'join', playerId, name: 'P1' });
    (replayGame.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [...library].reverse().map((card) => ({ ...card, zone: 'library' })),
        libraryCount: library.length,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    (replayGame as any).libraries = new Map([
      [playerId, [...library].reverse().map((card) => ({ ...card, zone: 'library' }))],
    ]);

    replayGame.replay([
      { type: 'surveilResolve', ...surveilResolveEvent.payload },
      { type: 'drawCards', ...drawEvent?.payload },
    ]);

    expect((replayGame.state as any).zones?.[playerId]?.hand?.map((card: any) => card.id)).toEqual(['draw-me']);
    expect((replayGame as any).libraries.get(playerId).map((card: any) => card.id)).toEqual([]);
    expect((replayGame.state as any).oracleIrPendingResumeStepsJson).toBeUndefined();

    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    await resetSocketGame(triggerGameId);
  });
});

describe('oracle IR surveil compound resume', () => {
  it('resumes draw after surveil choice via IR compound continuation', () => {
    const localGameId = 'oracle_ir_surveil_then_draw_compound';
    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest' },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island' },
    ];
    const { game, ctx, player } = setupLibraryGame(localGameId, library);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'consider-1',
      sourceName: 'Consider',
    });

    const firstPass = applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [
        {
          kind: 'surveil',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          raw: 'Surveil 1.',
        },
        {
          kind: 'draw',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          raw: 'Draw a card.',
        },
      ] as any,
      irCtx,
      { allowOptional: false },
      { controller: playerId },
    );

    expect(firstPass.pendingContinuationSteps?.map((step) => step.kind)).toEqual(['draw']);

    const surveilStep = ResolutionQueueManager.getStepsForPlayer(localGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SURVEIL) as any;
    expect(surveilStep).toBeTruthy();
    expect(String(surveilStep.oracleIrResumeStepsJson || '')).toContain('draw');

    game.applyEvent!({
      type: 'surveilResolve',
      playerId,
      keepTopOrder: [],
      toGraveyard: ['top-1'],
    } as any);

    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, surveilStep, {
      selections: {
        keepTopOrder: [],
        toGraveyard: ['top-1'],
      },
    });
    expect(resumed?.appliedSteps.map((step) => step.kind)).toEqual(['surveil']);

    maybeResumeOracleIRStepsAfterResolution(ctx, surveilStep);

    expect(player.hand.map((card: any) => card.id)).toEqual(['draw-me']);
    expect(player.library.map((card: any) => card.id)).toEqual([]);
    expect((game.state as any).zones?.[playerId]?.graveyard?.map((card: any) => card.id)).toEqual(['top-1']);
  });
});

describe('oracle IR surveil socket persist + replay', () => {
  const surveilGameId = 'test_oracle_ir_surveil_socket_replay';
  const surveilPlayerId = 'p1' as PlayerID;

  beforeAll(() => {
    initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
  });

  beforeEach(async () => {
    await resetSocketGame(surveilGameId);
  });

  afterEach(async () => {
    await resetSocketGame(surveilGameId);
  });

  it('persists surveilResolve ledger fields when IR-bridged surveil resolves via socket', async () => {
    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'top-2', name: 'Bolt', type_line: 'Instant', image_uris: { normal: 'bolt.png' } },
    ];

    createGameIfNotExists(surveilGameId, 'commander', 40, undefined, surveilPlayerId);
    const game = ensureGame(surveilGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = surveilGameId;

    (game.state as any).players = [{ id: surveilPlayerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [surveilPlayerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: library.map((card) => ({ ...card, zone: 'library' })),
        libraryCount: library.length,
      },
    };
    const player = (game.state as any).players.find((entry: any) => entry.id === surveilPlayerId);
    player.library = library.map((card) => ({ ...card, zone: 'library' }));
    game.libraries = new Map([[surveilPlayerId, library.map((card) => ({ ...card }))]]);

    const ctx = game as any;
    ctx.gameId = surveilGameId;
    ctx.state = game.state;
    ResolutionQueueManager.removeQueue(surveilGameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: surveilPlayerId,
      sourceId: 'surveil_spell_1',
      sourceName: 'Test Surveil',
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [{
        kind: 'surveil',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 2 },
        raw: 'Surveil 2.',
      }],
      irCtx,
      { allowOptional: false },
      { controller: surveilPlayerId },
    );

    const surveilStep = ResolutionQueueManager.getStepsForPlayer(surveilGameId, surveilPlayerId)
      .find((entry) => entry.type === ResolutionStepType.SURVEIL) as any;
    expect(surveilStep).toBeDefined();
    expect(surveilStep.oracleIrChoiceStepJson).toBeTruthy();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(surveilPlayerId, surveilGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId: surveilGameId,
      stepId: String(surveilStep.id),
      selections: {
        keepTopOrder: ['top-2'],
        toGraveyard: ['top-1'],
      },
    });

    expect(game.libraries.get(surveilPlayerId).map((card: any) => card.id)).toEqual(['top-2']);
    expect((game.state as any).zones?.[surveilPlayerId]?.graveyard?.map((card: any) => card.id)).toEqual(['top-1']);
    expect((game.state as any).oracleIrAppliedStepKinds?.get(0)).toBe('surveil');

    const resolvedEvent = [...getEvents(surveilGameId)].reverse().find((event) => event.type === 'surveilResolve') as any;
    expect(resolvedEvent).toBeDefined();
    expect(resolvedEvent.payload?.oracleIrAppliedStepKinds).toEqual([[0, 'surveil']]);
    expect(Array.isArray(resolvedEvent.payload?.oracleIrStepLedger)).toBe(true);

    const replayGame = createInitialGameState('test_oracle_ir_surveil_socket_replay_apply');
    replayGame.applyEvent({ type: 'join', playerId: surveilPlayerId, name: 'P1' });
    (replayGame.state as any).zones = {
      [surveilPlayerId]: {
        hand: [],
        handCount: 0,
        library: library.map((card) => ({ ...card, zone: 'library' })),
        libraryCount: library.length,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    (replayGame as any).libraries = new Map([
      [surveilPlayerId, library.map((card) => ({ ...card, zone: 'library' }))],
    ]);

    replayGame.applyEvent({
      type: 'surveilResolve',
      ...resolvedEvent.payload,
    });

    expect((replayGame as any).libraries.get(surveilPlayerId).map((card: any) => card.id)).toEqual(['top-2']);
    expect((replayGame.state as any).zones?.[surveilPlayerId]?.graveyard?.map((card: any) => card.id)).toEqual(['top-1']);
    expect((replayGame.state as any).oracleIrAppliedStepKinds?.get(0)).toBe('surveil');
  });
});
