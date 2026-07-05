import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { evaluateModifyPtWhereX } from '../../rules-engine/src/oracleIRExecutorModifyPtWhereEvaluator.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { assertNoReplayDivergence, toReplayEvents } from './helpers/replayDivergence.js';
import {
  readAppliedStepKindsFromState,
  readStepLedgerFromState,
} from '../src/state/modules/oracleIrTransitionPipeline.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { lookupLocalCardByNameSync } from '../src/services/localCardLookup.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler, processPendingOracleIrCompoundResume } from '../src/socket/resolution.js';
import { registerJoinHandlers } from '../src/socket/join.js';
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
  const optJoinCompoundGameId = 'test_oracle_ir_opt_join_compound';
  const considerJoinCompoundGameId = 'test_oracle_ir_consider_join_compound';
  const optScryPromptReplayGameId = 'test_oracle_ir_opt_scry_prompt_replay';
  const considerSurveilPromptReplayGameId = 'test_oracle_ir_consider_surveil_prompt_replay';

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
    await resetSocketGame(optJoinCompoundGameId);
    await resetSocketGame(considerJoinCompoundGameId);
    await resetSocketGame(optScryPromptReplayGameId);
    await resetSocketGame(considerSurveilPromptReplayGameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetSocketGame(gameId);
    await resetSocketGame(considerGameId);
    await resetSocketGame(optLedgerGameId);
    await resetSocketGame(considerLedgerGameId);
    await resetSocketGame(optCompoundReconnectGameId);
    await resetSocketGame(optJoinCompoundGameId);
    await resetSocketGame(considerJoinCompoundGameId);
    await resetSocketGame(optScryPromptReplayGameId);
    await resetSocketGame(considerSurveilPromptReplayGameId);
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

    const eventStart = getEvents(gameId).length;
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

    const drawEvent = [...getEvents(gameId)].reverse()
      .find((event) => event.type === 'drawCards' && (
        event.payload?.oracleIrCompoundResume === true
        || event.payload?.oracleIrReplayMutation === true
        || (Array.isArray(event.payload?.drawnCardIds) && event.payload.drawnCardIds.length > 0)
      ));
    expect(drawEvent).toBeDefined();
    expect(drawEvent?.payload?.drawnCardIds).toEqual(['draw-me']);

    const replayGameId = `${gameId}_replay_divergence`;
    const replayGame = createInitialGameState(replayGameId);
    setupStackSpellLibraryGame(replayGame, replayGameId, library);
    queueStackSpell(replayGame, {
      id: 'opt_1',
      name: 'Opt',
      type_line: 'Instant',
      oracle_text: 'Scry 1. Draw a card.',
      mana_cost: '{U}',
    }, 'opt_stack_1');
    replayGame.replay(toReplayEvents(gameId, eventStart) as any);
    assertNoReplayDivergence(game, replayGame);
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
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual(['top-1', 'consider_1']);
    expect(ResolutionQueueManager.getStepsForPlayer(considerGameId, playerId)).toHaveLength(0);
    expect((game.state as any).stack || []).toHaveLength(0);

    const drawEvent = [...getEvents(considerGameId)].reverse()
      .find((event) => event.type === 'drawCards' && event.payload?.oracleIrCompoundResume === true);
    expect(drawEvent).toBeDefined();
    expect(drawEvent?.payload?.drawnCardIds).toEqual(['draw-me']);
  });

  it('persists resolveTopOfStackPrompt for Opt scry and replays the queued selection', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    await resetSocketGame(optScryPromptReplayGameId);

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(optScryPromptReplayGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(optScryPromptReplayGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, optScryPromptReplayGameId, library);
    queueStackSpell(game, {
      id: 'opt_prompt_replay_1',
      name: 'Opt',
      type_line: 'Instant',
      oracle_text: 'Scry 1. Draw a card.',
      mana_cost: '{U}',
    }, 'opt_stack_prompt_replay_1');

    resolveTopOfStack(game as any);

    const promptEvent = [...getEvents(optScryPromptReplayGameId)].reverse().find((event: any) =>
      event.type === 'resolveTopOfStackPrompt'
      && event.payload?.queuedResolutionStep?.type === ResolutionStepType.SCRY,
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload?.queuedResolutionStep?.scryCount).toBe(1);
    expect((promptEvent.payload?.queuedResolutionStep?.cards || []).map((entry: any) => entry.id)).toEqual(['top-1']);
    expect(String(promptEvent.payload?.queuedResolutionStep?.oracleIrResumeStepsJson || '')).toContain('draw');

    const replayGame = createInitialGameState(optScryPromptReplayGameId);
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

    ResolutionQueueManager.removeQueue(optScryPromptReplayGameId);
    replayGame.applyEvent({
      type: 'resolveTopOfStackPrompt',
      ...(promptEvent.payload || {}),
    } as any);

    const replayScryStep = ResolutionQueueManager.getStepsForPlayer(optScryPromptReplayGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;
    expect(replayScryStep).toBeDefined();
    expect(replayScryStep.scryCount).toBe(1);
    expect((replayScryStep.cards || []).map((entry: any) => entry.id)).toEqual(['top-1']);
    expect(String(replayScryStep.oracleIrResumeStepsJson || '')).toContain('draw');

    await resetSocketGame(optScryPromptReplayGameId);
  });

  it('persists resolveTopOfStackPrompt for Consider surveil and replays the queued selection', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    await resetSocketGame(considerSurveilPromptReplayGameId);

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(considerSurveilPromptReplayGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(considerSurveilPromptReplayGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, considerSurveilPromptReplayGameId, library);
    queueStackSpell(game, {
      id: 'consider_prompt_replay_1',
      name: 'Consider',
      type_line: 'Instant',
      oracle_text: 'Surveil 1. Draw a card.',
      mana_cost: '{U}',
    }, 'consider_stack_prompt_replay_1');

    resolveTopOfStack(game as any);

    const promptEvent = [...getEvents(considerSurveilPromptReplayGameId)].reverse().find((event: any) =>
      event.type === 'resolveTopOfStackPrompt'
      && event.payload?.queuedResolutionStep?.type === ResolutionStepType.SURVEIL,
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload?.queuedResolutionStep?.surveilCount).toBe(1);
    expect((promptEvent.payload?.queuedResolutionStep?.cards || []).map((entry: any) => entry.id)).toEqual(['top-1']);
    expect(String(promptEvent.payload?.queuedResolutionStep?.oracleIrResumeStepsJson || '')).toContain('draw');

    const replayGame = createInitialGameState(considerSurveilPromptReplayGameId);
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

    ResolutionQueueManager.removeQueue(considerSurveilPromptReplayGameId);
    replayGame.applyEvent({
      type: 'resolveTopOfStackPrompt',
      ...(promptEvent.payload || {}),
    } as any);

    const replaySurveilStep = ResolutionQueueManager.getStepsForPlayer(considerSurveilPromptReplayGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SURVEIL) as any;
    expect(replaySurveilStep).toBeDefined();
    expect(replaySurveilStep.surveilCount).toBe(1);
    expect((replaySurveilStep.cards || []).map((entry: any) => entry.id)).toEqual(['top-1']);
    expect(String(replaySurveilStep.oracleIrResumeStepsJson || '')).toContain('draw');

    await resetSocketGame(considerSurveilPromptReplayGameId);
  });

  it('Consider stack socket replay with surveilResolve and drawCards uses drawnCardIds', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const replayGameId = 'test_oracle_ir_consider_stack_drawn_card_ids_replay';
    await resetSocketGame(replayGameId);

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(replayGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(replayGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, replayGameId, library);
    queueStackSpell(game, {
      id: 'consider_replay_1',
      name: 'Consider',
      type_line: 'Instant',
      oracle_text: 'Surveil 1. Draw a card.',
      mana_cost: '{U}',
    }, 'consider_stack_replay_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, replayGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const surveilStep = ResolutionQueueManager.getStepsForPlayer(replayGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SURVEIL) as any;
    await handlers['submitResolutionResponse']({
      gameId: replayGameId,
      stepId: String(surveilStep.id),
      selections: { keepTopOrder: [], toGraveyard: ['top-1'] },
    });

    const surveilResolveEvent = [...getEvents(replayGameId)].reverse()
      .find((event) => event.type === 'surveilResolve') as any;
    const drawEvent = [...getEvents(replayGameId)].reverse()
      .find((event) => event.type === 'drawCards' && event.payload?.oracleIrCompoundResume === true);
    expect(surveilResolveEvent).toBeDefined();
    expect(drawEvent).toBeDefined();
    expect(drawEvent?.payload?.drawnCardIds).toEqual(['draw-me']);

    const replayGame = createInitialGameState(replayGameId);
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
    expect((replayGame.state as any).zones?.[playerId]?.graveyard?.map((card: any) => card.id)).toEqual(['top-1']);
    expect((replayGame.state as any).oracleIrPendingResumeStepsJson).toBeUndefined();

    await resetSocketGame(replayGameId);
  });

  it('Opt stack socket replay with scryResolve and drawCards uses drawnCardIds', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const replayGameId = 'test_oracle_ir_opt_stack_drawn_card_ids_replay';
    await resetSocketGame(replayGameId);

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(replayGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(replayGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, replayGameId, library);
    queueStackSpell(game, {
      id: 'opt_replay_1',
      name: 'Opt',
      type_line: 'Instant',
      oracle_text: 'Scry 1. Draw a card.',
      mana_cost: '{U}',
    }, 'opt_stack_replay_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, replayGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const scryStep = ResolutionQueueManager.getStepsForPlayer(replayGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;
    await handlers['submitResolutionResponse']({
      gameId: replayGameId,
      stepId: String(scryStep.id),
      selections: { keepTopOrder: [], bottomOrder: ['top-1'] },
    });

    const scryResolveEvent = [...getEvents(replayGameId)].reverse()
      .find((event) => event.type === 'scryResolve') as any;
    const drawEvent = [...getEvents(replayGameId)].reverse()
      .find((event) => event.type === 'drawCards' && event.payload?.oracleIrCompoundResume === true);
    expect(scryResolveEvent).toBeDefined();
    expect(drawEvent).toBeDefined();
    expect(drawEvent?.payload?.drawnCardIds).toEqual(['draw-me']);

    const replayGame = createInitialGameState(replayGameId);
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
      { type: 'scryResolve', ...scryResolveEvent.payload },
      { type: 'drawCards', ...drawEvent?.payload },
    ]);

    expect((replayGame.state as any).zones?.[playerId]?.hand?.map((card: any) => card.id)).toEqual(['draw-me']);
    expect((replayGame as any).libraries.get(playerId).map((card: any) => card.id)).toEqual(['top-1']);
    expect((replayGame.state as any).oracleIrPendingResumeStepsJson).toBeUndefined();

    await resetSocketGame(replayGameId);
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

    const replayGame = createInitialGameState(optCompoundReconnectGameId);
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

    const autoDrawEvent = [...getEvents(optCompoundReconnectGameId)].reverse()
      .find((event) => event.type === 'drawCards' && event.payload?.oracleIrCompoundResume === true) as any;
    expect(autoDrawEvent).toBeDefined();
    expect(autoDrawEvent.payload?.drawnCardIds).toEqual(['draw-me']);

    expect((replayGame.state as any).zones?.[playerId]?.hand?.map((card: any) => card.id)).toEqual(['draw-me']);
    expect((replayGame as any).libraries.get(playerId).map((card: any) => card.id)).toEqual(['top-1']);
    expect((replayGame.state as any).oracleIrPendingResumeStepsJson).toBeUndefined();
  });

  it('joinGame completes Opt compound draw from scryResolve pending resume state', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    await resetSocketGame(optJoinCompoundGameId);

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(optJoinCompoundGameId, 'commander', 40, undefined, playerId);
    const liveGame = ensureGame(optJoinCompoundGameId);
    if (!liveGame) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(liveGame, optJoinCompoundGameId, library);
    queueStackSpell(liveGame, {
      id: 'opt_join_1',
      name: 'Opt',
      type_line: 'Instant',
      oracle_text: 'Scry 1. Draw a card.',
      mana_cost: '{U}',
    }, 'opt_stack_join_1');

    const liveEmitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: liveSocket, handlers: liveHandlers } = createMockSocket(playerId, optJoinCompoundGameId, liveEmitted);
    const liveIo = createMockIo(liveEmitted, [liveSocket]);
    registerResolutionHandlers(liveIo as any, liveSocket as any);

    resolveTopOfStack(liveGame as any);
    const scryStep = ResolutionQueueManager.getStepsForPlayer(optJoinCompoundGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;
    await liveHandlers['submitResolutionResponse']({
      gameId: optJoinCompoundGameId,
      stepId: String(scryStep.id),
      selections: {
        keepTopOrder: [],
        bottomOrder: ['top-1'],
      },
    });

    const resolvedEvent = [...getEvents(optJoinCompoundGameId)].reverse()
      .find((event) => event.type === 'scryResolve') as any;
    expect(resolvedEvent).toBeDefined();
    expect(String(resolvedEvent.payload?.oracleIrResumeStepsJson || '')).toContain('draw');

    ResolutionQueueManager.removeQueue(optJoinCompoundGameId);
    (liveGame.state as any).players = [{
      id: playerId,
      name: 'P1',
      spectator: false,
      life: 40,
      seatToken: 'seat_p1',
    }];
    (liveGame.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: library.map((card) => ({ ...card, zone: 'library' })),
        libraryCount: library.length,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    liveGame.libraries = new Map([
      [playerId, library.map((card) => ({ ...card, zone: 'library' }))],
    ]);
    delete (liveGame.state as any).oracleIrPendingResumeStepsJson;
    delete (liveGame.state as any).oracleIrPendingResumeControllerId;

    liveGame.applyEvent({
      type: 'scryResolve',
      ...resolvedEvent.payload,
    });

    expect((liveGame.state as any).zones?.[playerId]?.hand || []).toHaveLength(0);
    expect((liveGame as any).libraries.get(playerId).map((card: any) => card.id)).toEqual(['draw-me', 'top-1']);
    expect(String((liveGame.state as any).oracleIrPendingResumeStepsJson || '')).toContain('draw');

    const joinEmitted: Array<{ room?: string; event: string; payload: any }> = [];
    const joinHandlers: Record<string, (payload: any) => Promise<void> | void> = {};
    const joinSocket = {
      id: 'sock_opt_join',
      data: { spectator: false },
      rooms: new Set<string>(),
      on: (event: string, handler: (payload: any) => Promise<void> | void) => {
        joinHandlers[event] = handler;
      },
      emit: (event: string, payload: any) => joinEmitted.push({ event, payload }),
      join: (room: string) => joinSocket.rooms.add(room),
    };
    const joinIo = createMockIo(joinEmitted, [joinSocket]);

    registerJoinHandlers(joinIo as any, joinSocket as any);
    await joinHandlers['joinGame']({ gameId: optJoinCompoundGameId, fixedPlayerId: playerId });

    expect((liveGame.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id)).toEqual(['draw-me']);
    expect((liveGame as any).libraries.get(playerId).map((entry: any) => entry.id)).toEqual(['top-1']);
    expect((liveGame.state as any).oracleIrPendingResumeStepsJson).toBeUndefined();

    const drawEvent = [...getEvents(optJoinCompoundGameId)].reverse()
      .find((event) => event.type === 'drawCards' && event.payload?.oracleIrCompoundResume === true);
    expect(drawEvent).toBeDefined();
    expect(drawEvent?.payload?.drawnCardIds).toEqual(['draw-me']);
  });

  it('joinGame completes Consider compound draw from surveilResolve pending resume state', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    await resetSocketGame(considerJoinCompoundGameId);

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(considerJoinCompoundGameId, 'commander', 40, undefined, playerId);
    const liveGame = ensureGame(considerJoinCompoundGameId);
    if (!liveGame) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(liveGame, considerJoinCompoundGameId, library);
    queueStackSpell(liveGame, {
      id: 'consider_join_1',
      name: 'Consider',
      type_line: 'Instant',
      oracle_text: 'Surveil 1. Draw a card.',
      mana_cost: '{U}',
    }, 'consider_stack_join_1');

    const liveEmitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: liveSocket, handlers: liveHandlers } = createMockSocket(playerId, considerJoinCompoundGameId, liveEmitted);
    const liveIo = createMockIo(liveEmitted, [liveSocket]);
    registerResolutionHandlers(liveIo as any, liveSocket as any);

    resolveTopOfStack(liveGame as any);
    const surveilStep = ResolutionQueueManager.getStepsForPlayer(considerJoinCompoundGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SURVEIL) as any;
    await liveHandlers['submitResolutionResponse']({
      gameId: considerJoinCompoundGameId,
      stepId: String(surveilStep.id),
      selections: {
        keepTopOrder: [],
        toGraveyard: ['top-1'],
      },
    });

    const resolvedEvent = [...getEvents(considerJoinCompoundGameId)].reverse()
      .find((event) => event.type === 'surveilResolve') as any;
    expect(resolvedEvent).toBeDefined();
    expect(String(resolvedEvent.payload?.oracleIrResumeStepsJson || '')).toContain('draw');

    ResolutionQueueManager.removeQueue(considerJoinCompoundGameId);
    (liveGame.state as any).players = [{
      id: playerId,
      name: 'P1',
      spectator: false,
      life: 40,
      seatToken: 'seat_p1',
    }];
    (liveGame.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [{ id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', zone: 'library' }],
        libraryCount: 1,
        graveyard: [{ id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', zone: 'graveyard' }],
        graveyardCount: 1,
      },
    };
    liveGame.libraries = new Map([
      [playerId, [{ id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', zone: 'library' }]],
    ]);
    delete (liveGame.state as any).oracleIrPendingResumeStepsJson;
    delete (liveGame.state as any).oracleIrPendingResumeControllerId;

    liveGame.applyEvent({
      type: 'surveilResolve',
      ...resolvedEvent.payload,
    });

    expect((liveGame.state as any).zones?.[playerId]?.hand || []).toHaveLength(0);
    expect((liveGame as any).libraries.get(playerId).map((card: any) => card.id)).toEqual(['draw-me']);
    expect(String((liveGame.state as any).oracleIrPendingResumeStepsJson || '')).toContain('draw');

    const joinEmitted: Array<{ room?: string; event: string; payload: any }> = [];
    const joinHandlers: Record<string, (payload: any) => Promise<void> | void> = {};
    const joinSocket = {
      id: 'sock_consider_join',
      data: { spectator: false },
      rooms: new Set<string>(),
      on: (event: string, handler: (payload: any) => Promise<void> | void) => {
        joinHandlers[event] = handler;
      },
      emit: (event: string, payload: any) => joinEmitted.push({ event, payload }),
      join: (room: string) => joinSocket.rooms.add(room),
    };
    const joinIo = createMockIo(joinEmitted, [joinSocket]);

    registerJoinHandlers(joinIo as any, joinSocket as any);
    await joinHandlers['joinGame']({ gameId: considerJoinCompoundGameId, fixedPlayerId: playerId });

    expect((liveGame.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id)).toEqual(['draw-me']);
    expect((liveGame as any).libraries.get(playerId).map((entry: any) => entry.id)).toEqual([]);
    expect((liveGame.state as any).oracleIrPendingResumeStepsJson).toBeUndefined();

    const drawEvent = [...getEvents(considerJoinCompoundGameId)].reverse()
      .find((event) => event.type === 'drawCards' && event.payload?.oracleIrCompoundResume === true);
    expect(drawEvent).toBeDefined();
    expect(drawEvent?.payload?.drawnCardIds).toEqual(['draw-me']);
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
    expect(drawEvent.payload?.drawnCardIds).toEqual(['draw-me']);

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

    const liveDrawEvent = [...getEvents(appendGameId)].reverse()
      .find((event) => event.type === 'drawCards' && event.payload?.oracleIrCompoundResume === true) as any;
    expect(liveDrawEvent).toBeDefined();
    expect(liveDrawEvent.payload?.drawnCardIds).toEqual(['draw-me']);

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
    expect(drawEvent.payload?.drawnCardIds).toEqual(['draw-me']);
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

describe('oracle IR scry-2 compound stack resolve E2E', () => {
  const preordainGameId = 'test_oracle_ir_preordain_stack_resolve';
  const preordainJoinCompoundGameId = 'test_oracle_ir_preordain_join_compound';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetSocketGame(preordainGameId);
    await resetSocketGame(preordainJoinCompoundGameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetSocketGame(preordainGameId);
    await resetSocketGame(preordainJoinCompoundGameId);
  });

  it('resolveTopOfStack on Preordain queues IR scry 2 then socket completes compound draw', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const card = lookupLocalCardByNameSync('Preordain');
    const oracleText = String(card?.oracle_text || 'Scry 2, then draw a card.').trim();
    expect(oracleText.toLowerCase()).toContain('scry 2');
    expect(oracleText.toLowerCase()).toContain('draw');

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'top-2', name: 'Plains', type_line: 'Basic Land — Plains', image_uris: { normal: 'plains.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
      { id: 'bottom', name: 'Mountain', type_line: 'Basic Land — Mountain', image_uris: { normal: 'mountain.png' } },
    ];

    createGameIfNotExists(preordainGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(preordainGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, preordainGameId, library);
    queueStackSpell(game, {
      id: 'preordain_1',
      name: 'Preordain',
      type_line: String(card?.type_line || 'Sorcery'),
      oracle_text: oracleText,
      mana_cost: String(card?.mana_cost || '{U}'),
    }, 'preordain_stack_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, preordainGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const scryStep = ResolutionQueueManager.getStepsForPlayer(preordainGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;
    expect(scryStep).toBeDefined();
    expect(scryStep.scryCount).toBe(2);
    expect(String(scryStep.oracleIrChoiceStepJson || '')).toContain('scry');
    expect(String(scryStep.oracleIrResumeStepsJson || '')).toContain('draw');

    await handlers['submitResolutionResponse']({
      gameId: preordainGameId,
      stepId: String(scryStep.id),
      selections: {
        keepTopOrder: [],
        bottomOrder: ['top-1', 'top-2'],
      },
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.hand || []).map((entry: any) => entry.id)).toEqual(['draw-me']);
    expect(game.libraries.get(playerId).map((entry: any) => entry.id)).toEqual(['bottom', 'top-1', 'top-2']);
    expect(ResolutionQueueManager.getStepsForPlayer(preordainGameId, playerId)).toHaveLength(0);
    expect((game.state as any).stack || []).toHaveLength(0);

    const drawEvent = [...getEvents(preordainGameId)].reverse()
      .find((event) => event.type === 'drawCards' && event.payload?.oracleIrCompoundResume === true);
    expect(drawEvent).toBeDefined();
    expect(drawEvent?.payload?.drawnCardIds).toEqual(['draw-me']);
  });

  it('joinGame completes Preordain compound draw from scryResolve pending resume state', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    await resetSocketGame(preordainJoinCompoundGameId);

    const card = lookupLocalCardByNameSync('Preordain');
    const oracleText = String(card?.oracle_text || 'Scry 2, then draw a card.').trim();

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'top-2', name: 'Plains', type_line: 'Basic Land — Plains', image_uris: { normal: 'plains.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
      { id: 'bottom', name: 'Mountain', type_line: 'Basic Land — Mountain', image_uris: { normal: 'mountain.png' } },
    ];

    createGameIfNotExists(preordainJoinCompoundGameId, 'commander', 40, undefined, playerId);
    const liveGame = ensureGame(preordainJoinCompoundGameId);
    if (!liveGame) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(liveGame, preordainJoinCompoundGameId, library);
    queueStackSpell(liveGame, {
      id: 'preordain_join_1',
      name: 'Preordain',
      type_line: String(card?.type_line || 'Sorcery'),
      oracle_text: oracleText,
      mana_cost: String(card?.mana_cost || '{U}'),
    }, 'preordain_stack_join_1');

    const liveEmitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: liveSocket, handlers: liveHandlers } = createMockSocket(playerId, preordainJoinCompoundGameId, liveEmitted);
    const liveIo = createMockIo(liveEmitted, [liveSocket]);
    registerResolutionHandlers(liveIo as any, liveSocket as any);

    resolveTopOfStack(liveGame as any);
    const scryStep = ResolutionQueueManager.getStepsForPlayer(preordainJoinCompoundGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;
    expect(scryStep?.scryCount).toBe(2);

    await liveHandlers['submitResolutionResponse']({
      gameId: preordainJoinCompoundGameId,
      stepId: String(scryStep.id),
      selections: {
        keepTopOrder: [],
        bottomOrder: ['top-1', 'top-2'],
      },
    });

    const resolvedEvent = [...getEvents(preordainJoinCompoundGameId)].reverse()
      .find((event) => event.type === 'scryResolve') as any;
    expect(resolvedEvent).toBeDefined();
    expect(String(resolvedEvent.payload?.oracleIrResumeStepsJson || '')).toContain('draw');

    ResolutionQueueManager.removeQueue(preordainJoinCompoundGameId);
    (liveGame.state as any).players = [{
      id: playerId,
      name: 'P1',
      spectator: false,
      life: 40,
      seatToken: 'seat_p1',
    }];
    (liveGame.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: library.map((entry) => ({ ...entry, zone: 'library' })),
        libraryCount: library.length,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    liveGame.libraries = new Map([
      [playerId, library.map((entry) => ({ ...entry, zone: 'library' }))],
    ]);
    delete (liveGame.state as any).oracleIrPendingResumeStepsJson;
    delete (liveGame.state as any).oracleIrPendingResumeControllerId;

    liveGame.applyEvent({
      type: 'scryResolve',
      ...resolvedEvent.payload,
    });

    expect((liveGame.state as any).zones?.[playerId]?.hand || []).toHaveLength(0);
    expect((liveGame as any).libraries.get(playerId).map((entry: any) => entry.id))
      .toEqual(['draw-me', 'bottom', 'top-1', 'top-2']);
    expect(String((liveGame.state as any).oracleIrPendingResumeStepsJson || '')).toContain('draw');

    const joinEmitted: Array<{ room?: string; event: string; payload: any }> = [];
    const joinHandlers: Record<string, (payload: any) => Promise<void> | void> = {};
    const joinSocket = {
      id: 'sock_preordain_join',
      data: { spectator: false },
      rooms: new Set<string>(),
      on: (event: string, handler: (payload: any) => Promise<void> | void) => {
        joinHandlers[event] = handler;
      },
      emit: (event: string, payload: any) => joinEmitted.push({ event, payload }),
      join: (room: string) => joinSocket.rooms.add(room),
    };
    const joinIo = createMockIo(joinEmitted, [joinSocket]);

    registerJoinHandlers(joinIo as any, joinSocket as any);
    await joinHandlers['joinGame']({ gameId: preordainJoinCompoundGameId, fixedPlayerId: playerId });

    expect((liveGame.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id)).toEqual(['draw-me']);
    expect((liveGame as any).libraries.get(playerId).map((entry: any) => entry.id)).toEqual(['bottom', 'top-1', 'top-2']);
    expect((liveGame.state as any).oracleIrPendingResumeStepsJson).toBeUndefined();

    const drawEvent = [...getEvents(preordainJoinCompoundGameId)].reverse()
      .find((event) => event.type === 'drawCards' && event.payload?.oracleIrCompoundResume === true);
    expect(drawEvent).toBeDefined();
    expect(drawEvent?.payload?.drawnCardIds).toEqual(['draw-me']);
  });
});

describe('oracle IR draw-then-scry stack resolve E2E', () => {
  const serumVisionsGameId = 'test_oracle_ir_serum_visions_stack_resolve';
  const serumVisionsJoinGameId = 'test_oracle_ir_serum_visions_join_scry';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetSocketGame(serumVisionsGameId);
    await resetSocketGame(serumVisionsJoinGameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetSocketGame(serumVisionsGameId);
    await resetSocketGame(serumVisionsJoinGameId);
  });

  it('resolveTopOfStack on Serum Visions draws then queues IR scry 2 via socket', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const card = lookupLocalCardByNameSync('Serum Visions');
    const oracleText = String(card?.oracle_text || 'Draw a card. Scry 2.').trim();
    expect(oracleText.toLowerCase()).toMatch(/draw/);
    expect(oracleText.toLowerCase()).toContain('scry 2');

    const library = [
      { id: 'draw-first', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'top-2', name: 'Plains', type_line: 'Basic Land — Plains', image_uris: { normal: 'plains.png' } },
      { id: 'bottom', name: 'Mountain', type_line: 'Basic Land — Mountain', image_uris: { normal: 'mountain.png' } },
    ];

    createGameIfNotExists(serumVisionsGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(serumVisionsGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, serumVisionsGameId, library);
    queueStackSpell(game, {
      id: 'serum_visions_1',
      name: 'Serum Visions',
      type_line: String(card?.type_line || 'Instant'),
      oracle_text: oracleText,
      mana_cost: String(card?.mana_cost || '{U}'),
    }, 'serum_visions_stack_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, serumVisionsGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    expect((game.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id)).toEqual(['draw-first']);
    expect(game.libraries.get(playerId).map((entry: any) => entry.id)).toEqual(['top-2', 'bottom']);

    const scryStep = ResolutionQueueManager.getStepsForPlayer(serumVisionsGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;
    expect(scryStep).toBeDefined();
    expect(scryStep.scryCount).toBe(2);
    expect(String(scryStep.oracleIrChoiceStepJson || '')).toContain('scry');
    expect(String(scryStep.oracleIrResumeStepsJson || '')).not.toContain('draw');

    await handlers['submitResolutionResponse']({
      gameId: serumVisionsGameId,
      stepId: String(scryStep.id),
      selections: {
        keepTopOrder: [],
        bottomOrder: ['top-2', 'bottom'],
      },
    });

    expect((game.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id)).toEqual(['draw-first']);
    expect(game.libraries.get(playerId).map((entry: any) => entry.id)).toEqual(['top-2', 'bottom']);
    expect(ResolutionQueueManager.getStepsForPlayer(serumVisionsGameId, playerId)).toHaveLength(0);
    expect((game.state as any).stack || []).toHaveLength(0);
  });

  it('joinGame re-emits Serum Visions scry after resolveTopOfStackPrompt replay then socket completes', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    await resetSocketGame(serumVisionsJoinGameId);

    const card = lookupLocalCardByNameSync('Serum Visions');
    const oracleText = String(card?.oracle_text || 'Draw a card. Scry 2.').trim();

    const library = [
      { id: 'draw-first', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'top-2', name: 'Plains', type_line: 'Basic Land — Plains', image_uris: { normal: 'plains.png' } },
      { id: 'bottom', name: 'Mountain', type_line: 'Basic Land — Mountain', image_uris: { normal: 'mountain.png' } },
    ];

    createGameIfNotExists(serumVisionsJoinGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(serumVisionsJoinGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, serumVisionsJoinGameId, library);
    queueStackSpell(game, {
      id: 'serum_visions_join_1',
      name: 'Serum Visions',
      type_line: String(card?.type_line || 'Instant'),
      oracle_text: oracleText,
      mana_cost: String(card?.mana_cost || '{U}'),
    }, 'serum_visions_stack_join_1');

    resolveTopOfStack(game as any);

    expect((game.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id)).toEqual(['draw-first']);
    expect(game.libraries.get(playerId).map((entry: any) => entry.id)).toEqual(['top-2', 'bottom']);

    const promptEvent = [...getEvents(serumVisionsJoinGameId)].reverse().find((event: any) =>
      event.type === 'resolveTopOfStackPrompt'
      && event.payload?.queuedResolutionStep?.type === ResolutionStepType.SCRY,
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload?.queuedResolutionStep?.scryCount).toBe(2);

    ResolutionQueueManager.removeQueue(serumVisionsJoinGameId);
    expect(ResolutionQueueManager.getStepsForPlayer(serumVisionsJoinGameId, playerId)).toHaveLength(0);

    (game.state as any).players = [{
      id: playerId,
      name: 'P1',
      spectator: false,
      life: 40,
      seatToken: 'seat_p1',
    }];

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      ...(promptEvent.payload || {}),
    } as any);

    const restoredScryStep = ResolutionQueueManager.getStepsForPlayer(serumVisionsJoinGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;
    expect(restoredScryStep).toBeDefined();
    expect(restoredScryStep.scryCount).toBe(2);

    const joinEmitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: joinSocket, handlers: joinHandlers } = createMockSocket(playerId, serumVisionsJoinGameId, joinEmitted);
    const joinIo = createMockIo(joinEmitted, [joinSocket]);
    registerJoinHandlers(joinIo as any, joinSocket as any);
    registerResolutionHandlers(joinIo as any, joinSocket as any);

    await joinHandlers['joinGame']({ gameId: serumVisionsJoinGameId, fixedPlayerId: playerId });

    const stateEventIndex = joinEmitted.findIndex((entry) => entry.event === 'state');
    const promptEventIndex = joinEmitted.findIndex((entry) => entry.event === 'resolutionStepPrompt');
    expect(stateEventIndex).toBeGreaterThanOrEqual(0);
    expect(promptEventIndex).toBeGreaterThan(stateEventIndex);
    expect(joinEmitted[promptEventIndex]?.payload?.step?.type).toBe('scry');
    expect(joinEmitted[promptEventIndex]?.payload?.step?.scryCount).toBe(2);

    await joinHandlers['submitResolutionResponse']({
      gameId: serumVisionsJoinGameId,
      stepId: String(restoredScryStep.id),
      selections: {
        keepTopOrder: [],
        bottomOrder: ['top-2', 'bottom'],
      },
    });

    expect((game.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id)).toEqual(['draw-first']);
    expect(game.libraries.get(playerId).map((entry: any) => entry.id)).toEqual(['top-2', 'bottom']);
    expect(ResolutionQueueManager.getStepsForPlayer(serumVisionsJoinGameId, playerId)).toHaveLength(0);
    expect((game.state as any).stack || []).toHaveLength(0);

    await resetSocketGame(serumVisionsJoinGameId);
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

describe('oracle IR Chart a Course stack resolve E2E', () => {
  const chartGameId = 'test_oracle_ir_chart_course_stack_resolve';
  const chartSkipDiscardGameId = 'test_oracle_ir_chart_course_skip_discard';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetSocketGame(chartGameId);
    await resetSocketGame(chartSkipDiscardGameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetSocketGame(chartGameId);
    await resetSocketGame(chartSkipDiscardGameId);
  });

  it('resolveTopOfStack draws two then queues unless-attack discard via socket', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const card = lookupLocalCardByNameSync('Chart a Course');
    const oracleText = String(card?.oracle_text || '').trim();
    expect(oracleText.length).toBeGreaterThan(0);

    const library = [
      { id: 'draw-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-2', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
      { id: 'bottom', name: 'Mountain', type_line: 'Basic Land — Mountain', image_uris: { normal: 'mountain.png' } },
    ];

    createGameIfNotExists(chartGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(chartGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, chartGameId, library);
    (game.state as any).attackedPlayersThisTurnByPlayer = { [playerId]: [] };

    queueStackSpell(game, {
      id: 'chart_1',
      name: 'Chart a Course',
      type_line: String(card?.type_line || 'Sorcery'),
      oracle_text: oracleText,
      mana_cost: String(card?.mana_cost || '{1}{U}'),
    }, 'chart_stack_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, chartGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const zonesAfterDraw = (game.state as any).zones?.[playerId];
    expect((zonesAfterDraw?.hand || []).map((entry: any) => entry.id)).toEqual(['draw-1', 'draw-2']);
    expect(game.libraries.get(playerId).map((entry: any) => entry.id)).toEqual(['bottom']);

    const discardStep = ResolutionQueueManager.getStepsForPlayer(chartGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toBeDefined();
    expect(discardStep.discardCount).toBe(1);

    await handlers['submitResolutionResponse']({
      gameId: chartGameId,
      stepId: String(discardStep.id),
      selections: ['draw-1'],
    });

    expect((game.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id)).toEqual(['draw-2']);
    // Discarded card hits the graveyard during resolution; the spell card follows
    // once resolution finishes (CR 608.2m deferred finalize).
    expect((game.state as any).zones?.[playerId]?.graveyard?.map((entry: any) => entry.id)).toEqual(['draw-1', 'chart_1']);
    expect(ResolutionQueueManager.getStepsForPlayer(chartGameId, playerId)).toHaveLength(0);
    expect((game.state as any).stack || []).toHaveLength(0);
  });

  it('resolveTopOfStack skips discard when controller attacked this turn', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const card = lookupLocalCardByNameSync('Chart a Course');
    const oracleText = String(card?.oracle_text || '').trim();
    expect(oracleText.length).toBeGreaterThan(0);

    const library = [
      { id: 'draw-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-2', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(chartSkipDiscardGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(chartSkipDiscardGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, chartSkipDiscardGameId, library);
    (game.state as any).attackedPlayersThisTurnByPlayer = { [playerId]: ['attacker-1'] };

    queueStackSpell(game, {
      id: 'chart_2',
      name: 'Chart a Course',
      type_line: String(card?.type_line || 'Sorcery'),
      oracle_text: oracleText,
      mana_cost: String(card?.mana_cost || '{1}{U}'),
    }, 'chart_stack_2');

    resolveTopOfStack(game as any);

    expect((game.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id)).toEqual(['draw-1', 'draw-2']);
    expect(ResolutionQueueManager.getStepsForPlayer(chartSkipDiscardGameId, playerId)).toHaveLength(0);
    expect((game.state as any).stack || []).toHaveLength(0);
    expect((game.state as any).pendingDiscard?.[playerId]).toBeUndefined();
  });

  it('persists resolveTopOfStackPrompt for discard and replays the queued selection', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const replayGameId = 'test_oracle_ir_chart_course_discard_prompt_replay';
    await resetSocketGame(replayGameId);

    const card = lookupLocalCardByNameSync('Chart a Course');
    const oracleText = String(card?.oracle_text || '').trim();

    const library = [
      { id: 'draw-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-2', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(replayGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(replayGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, replayGameId, library);
    (game.state as any).attackedPlayersThisTurnByPlayer = { [playerId]: [] };

    queueStackSpell(game, {
      id: 'chart_replay_1',
      name: 'Chart a Course',
      type_line: String(card?.type_line || 'Sorcery'),
      oracle_text: oracleText,
      mana_cost: String(card?.mana_cost || '{1}{U}'),
    }, 'chart_stack_replay_1');

    resolveTopOfStack(game as any);

    const promptEvent = [...getEvents(replayGameId)].reverse().find((event: any) =>
      event.type === 'resolveTopOfStackPrompt'
      && event.payload?.queuedResolutionStep?.type === ResolutionStepType.DISCARD_SELECTION,
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload?.queuedResolutionStep?.discardCount).toBe(1);
    expect((promptEvent.payload?.queuedResolutionStep?.hand || []).map((entry: any) => entry.id)).toEqual(['draw-1', 'draw-2']);

    const replayGame = createInitialGameState(replayGameId);
    replayGame.applyEvent({ type: 'join', playerId, name: 'P1' });
    (replayGame.state as any).zones = {
      [playerId]: {
        hand: [
          { id: 'draw-1', name: 'Forest', type_line: 'Basic Land — Forest' },
          { id: 'draw-2', name: 'Island', type_line: 'Basic Land — Island' },
        ],
        handCount: 2,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    ResolutionQueueManager.removeQueue(replayGameId);
    replayGame.applyEvent({
      type: 'resolveTopOfStackPrompt',
      ...(promptEvent.payload || {}),
    } as any);

    const replayDiscardStep = ResolutionQueueManager.getStepsForPlayer(replayGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(replayDiscardStep).toBeDefined();
    expect(replayDiscardStep.discardCount).toBe(1);
    expect((replayDiscardStep.hand || []).map((entry: any) => entry.id)).toEqual(['draw-1', 'draw-2']);

    await resetSocketGame(replayGameId);
  });

  it('joinGame re-emits Chart a Course discard after resolveTopOfStackPrompt replay then socket completes', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const chartJoinGameId = 'test_oracle_ir_chart_course_join_discard';
    await resetSocketGame(chartJoinGameId);

    const card = lookupLocalCardByNameSync('Chart a Course');
    const oracleText = String(card?.oracle_text || '').trim();
    expect(oracleText.length).toBeGreaterThan(0);

    const library = [
      { id: 'draw-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-2', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
      { id: 'bottom', name: 'Mountain', type_line: 'Basic Land — Mountain', image_uris: { normal: 'mountain.png' } },
    ];

    createGameIfNotExists(chartJoinGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(chartJoinGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, chartJoinGameId, library);
    (game.state as any).attackedPlayersThisTurnByPlayer = { [playerId]: [] };

    queueStackSpell(game, {
      id: 'chart_join_1',
      name: 'Chart a Course',
      type_line: String(card?.type_line || 'Sorcery'),
      oracle_text: oracleText,
      mana_cost: String(card?.mana_cost || '{1}{U}'),
    }, 'chart_stack_join_1');

    resolveTopOfStack(game as any);

    expect((game.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id)).toEqual(['draw-1', 'draw-2']);

    const promptEvent = [...getEvents(chartJoinGameId)].reverse().find((event: any) =>
      event.type === 'resolveTopOfStackPrompt'
      && event.payload?.queuedResolutionStep?.type === ResolutionStepType.DISCARD_SELECTION,
    ) as any;
    expect(promptEvent).toBeDefined();

    ResolutionQueueManager.removeQueue(chartJoinGameId);
    expect(ResolutionQueueManager.getStepsForPlayer(chartJoinGameId, playerId)).toHaveLength(0);

    (game.state as any).players = [{
      id: playerId,
      name: 'P1',
      spectator: false,
      life: 40,
      seatToken: 'seat_p1',
    }];

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      ...(promptEvent.payload || {}),
    } as any);

    const restoredDiscardStep = ResolutionQueueManager.getStepsForPlayer(chartJoinGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(restoredDiscardStep).toBeDefined();
    expect(restoredDiscardStep.discardCount).toBe(1);

    const joinEmitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: joinSocket, handlers: joinHandlers } = createMockSocket(playerId, chartJoinGameId, joinEmitted);
    const joinIo = createMockIo(joinEmitted, [joinSocket]);
    registerJoinHandlers(joinIo as any, joinSocket as any);
    registerResolutionHandlers(joinIo as any, joinSocket as any);

    await joinHandlers['joinGame']({ gameId: chartJoinGameId, fixedPlayerId: playerId });

    const stateEventIndex = joinEmitted.findIndex((entry) => entry.event === 'state');
    const promptEventIndex = joinEmitted.findIndex((entry) => entry.event === 'resolutionStepPrompt');
    expect(stateEventIndex).toBeGreaterThanOrEqual(0);
    expect(promptEventIndex).toBeGreaterThan(stateEventIndex);
    expect(joinEmitted[promptEventIndex]?.payload?.step?.type).toBe('discard_selection');
    expect(joinEmitted[promptEventIndex]?.payload?.step?.discardCount).toBe(1);

    await joinHandlers['submitResolutionResponse']({
      gameId: chartJoinGameId,
      stepId: String(restoredDiscardStep.id),
      selections: ['draw-1'],
    });

    expect((game.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id)).toEqual(['draw-2']);
    // Discarded card hits the graveyard during resolution; the spell card follows
    // once resolution finishes (CR 608.2m deferred finalize).
    expect((game.state as any).zones?.[playerId]?.graveyard?.map((entry: any) => entry.id)).toEqual(['draw-1', 'chart_join_1']);
    expect(ResolutionQueueManager.getStepsForPlayer(chartJoinGameId, playerId)).toHaveLength(0);
    expect((game.state as any).stack || []).toHaveLength(0);

    await resetSocketGame(chartJoinGameId);
  });
});

describe('oracle IR library-search compound draw stack E2E', () => {
  const searchDrawGameId = 'test_oracle_ir_search_draw_compound_stack';
  const searchDrawReplayGameId = 'test_oracle_ir_search_draw_compound_replay';
  const searchDrawReconnectGameId = 'test_oracle_ir_search_draw_compound_reconnect';

  const searchDrawOracleText =
    'Search your library for a basic land card, reveal it, put it onto the battlefield tapped, then shuffle. '
    + 'If you searched your library this way, draw a card.';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetSocketGame(searchDrawGameId);
    await resetSocketGame(searchDrawReplayGameId);
    await resetSocketGame(searchDrawReconnectGameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetSocketGame(searchDrawGameId);
    await resetSocketGame(searchDrawReplayGameId);
    await resetSocketGame(searchDrawReconnectGameId);
  });

  it('resolveTopOfStack queues library search then socket response completes conditional draw', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const library = [
      { id: 'land-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(searchDrawGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(searchDrawGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, searchDrawGameId, library);

    queueStackSpell(game, {
      id: 'search_draw_1',
      name: 'Probe Search Draw',
      type_line: 'Sorcery',
      oracle_text: searchDrawOracleText,
      mana_cost: '{2}{G}',
    }, 'search_draw_stack_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, searchDrawGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const searchStep = ResolutionQueueManager.getStepsForPlayer(searchDrawGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    expect(searchStep).toBeDefined();
    expect(String(searchStep.oracleIrChoiceStepJson || '')).toContain('search_library');
    expect(String(searchStep.oracleIrResumeStepsJson || '')).toContain('conditional');

    await handlers['submitResolutionResponse']({
      gameId: searchDrawGameId,
      stepId: String(searchStep.id),
      selections: ['land-1'],
    });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.some((perm: any) => perm?.card?.id === 'land-1' && perm?.tapped === true)).toBe(true);
    expect((game.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id)).toEqual(['draw-me']);
    expect(ResolutionQueueManager.getStepsForPlayer(searchDrawGameId, playerId)).toHaveLength(0);
    expect((game.state as any).stack || []).toHaveLength(0);

    const searchResolveEvent = [...getEvents(searchDrawGameId)].reverse()
      .find((event) => event.type === 'librarySearchResolve') as any;
    const drawEvent = [...getEvents(searchDrawGameId)].reverse()
      .find((event) => event.type === 'drawCards' && event.payload?.oracleIrCompoundResume === true);
    expect(searchResolveEvent).toBeDefined();
    expect(Array.isArray(searchResolveEvent.payload?.oracleIrStepLedger)).toBe(true);
    expect(drawEvent).toBeDefined();
    expect(drawEvent?.payload?.drawnCardIds).toEqual(['draw-me']);
  });

  it('librarySearchResolve and drawCards replay restores compound draw with shuffled library order', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const library = [
      { id: 'land-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(searchDrawReplayGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(searchDrawReplayGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, searchDrawReplayGameId, library);

    queueStackSpell(game, {
      id: 'search_draw_replay_1',
      name: 'Probe Search Draw',
      type_line: 'Sorcery',
      oracle_text: searchDrawOracleText,
      mana_cost: '{2}{G}',
    }, 'search_draw_stack_replay_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, searchDrawReplayGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const searchStep = ResolutionQueueManager.getStepsForPlayer(searchDrawReplayGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    await handlers['submitResolutionResponse']({
      gameId: searchDrawReplayGameId,
      stepId: String(searchStep.id),
      selections: ['land-1'],
    });

    const searchResolveEvent = [...getEvents(searchDrawReplayGameId)].reverse()
      .find((event) => event.type === 'librarySearchResolve') as any;
    const drawEvent = [...getEvents(searchDrawReplayGameId)].reverse()
      .find((event) => event.type === 'drawCards' && event.payload?.oracleIrCompoundResume === true);
    expect(searchResolveEvent).toBeDefined();
    expect(drawEvent).toBeDefined();

    const replayGame = createInitialGameState(searchDrawReplayGameId);
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
      { type: 'librarySearchResolve', ...searchResolveEvent.payload },
      { type: 'drawCards', ...drawEvent?.payload },
    ]);

    expect((replayGame.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id)).toEqual(['draw-me']);
    expect((replayGame.state as any).battlefield?.some((perm: any) => perm?.card?.id === 'land-1' && perm?.tapped === true)).toBe(true);
    expect((replayGame.state as any).oracleIrPendingResumeStepsJson).toBeUndefined();
  });

  it('persists oracleIrResumeStepsJson on librarySearchResolve and replays compound draw after reconnect', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const library = [
      { id: 'land-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(searchDrawReconnectGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(searchDrawReconnectGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, searchDrawReconnectGameId, library);

    queueStackSpell(game, {
      id: 'search_draw_reconnect_1',
      name: 'Probe Search Draw',
      type_line: 'Sorcery',
      oracle_text: searchDrawOracleText,
      mana_cost: '{2}{G}',
    }, 'search_draw_stack_reconnect_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, searchDrawReconnectGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const searchStep = ResolutionQueueManager.getStepsForPlayer(searchDrawReconnectGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    await handlers['submitResolutionResponse']({
      gameId: searchDrawReconnectGameId,
      stepId: String(searchStep.id),
      selections: ['land-1'],
    });

    const resolvedEvent = [...getEvents(searchDrawReconnectGameId)].reverse()
      .find((event) => event.type === 'librarySearchResolve') as any;
    expect(resolvedEvent).toBeDefined();
    expect(String(resolvedEvent.payload?.oracleIrResumeStepsJson || '')).toContain('conditional');
    expect(resolvedEvent.payload?.oracleIrControllerId).toBe(playerId);
    expect(resolvedEvent.payload?.oracleIrSourceName).toBe('Probe Search Draw');

    const replayGame = createInitialGameState('test_oracle_ir_search_draw_compound_reconnect_apply');
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
      type: 'librarySearchResolve',
      ...resolvedEvent.payload,
    });

    expect((replayGame.state as any).zones?.[playerId]?.hand || []).toHaveLength(0);
    expect((replayGame as any).libraries.get(playerId).map((card: any) => card.id)).toEqual(['draw-me']);
    expect((replayGame.state as any).battlefield?.some((perm: any) => perm?.card?.id === 'land-1' && perm?.tapped === true)).toBe(true);
    expect(String((replayGame.state as any).oracleIrPendingResumeStepsJson || '')).toContain('conditional');

    const replayCtx = replayGame as any;
    replayCtx.gameId = 'test_oracle_ir_search_draw_compound_reconnect_apply';
    replayCtx.state = replayGame.state;
    replayCtx.libraries = (replayGame as any).libraries;

    const resumed = resumeOracleIrPendingCompoundStepsFromState(replayCtx);
    expect(resumed?.appliedSteps.map((step) => step.kind)).toContain('draw');
    expect((replayGame.state as any).zones?.[playerId]?.hand?.map((card: any) => card.id)).toEqual(['draw-me']);
    expect((replayGame as any).libraries.get(playerId).map((card: any) => card.id)).toEqual([]);
    expect((replayGame.state as any).oracleIrPendingResumeStepsJson).toBeUndefined();
  });

  it('replay auto-resumes library-search compound draw after librarySearchResolve event', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const library = [
      { id: 'land-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(searchDrawReconnectGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(searchDrawReconnectGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, searchDrawReconnectGameId, library);

    queueStackSpell(game, {
      id: 'search_draw_auto_1',
      name: 'Probe Search Draw',
      type_line: 'Sorcery',
      oracle_text: searchDrawOracleText,
      mana_cost: '{2}{G}',
    }, 'search_draw_stack_auto_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, searchDrawReconnectGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const searchStep = ResolutionQueueManager.getStepsForPlayer(searchDrawReconnectGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    await handlers['submitResolutionResponse']({
      gameId: searchDrawReconnectGameId,
      stepId: String(searchStep.id),
      selections: ['land-1'],
    });

    const resolvedEvent = [...getEvents(searchDrawReconnectGameId)].reverse()
      .find((event) => event.type === 'librarySearchResolve') as any;
    expect(resolvedEvent).toBeDefined();

    const replayGame = createInitialGameState(searchDrawReconnectGameId);
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
      type: 'librarySearchResolve',
      ...resolvedEvent.payload,
    }]);

    const autoDrawEvent = [...getEvents(searchDrawReconnectGameId)].reverse()
      .find((event) => event.type === 'drawCards' && event.payload?.oracleIrCompoundResume === true) as any;
    expect(autoDrawEvent).toBeDefined();
    expect(autoDrawEvent.payload?.drawnCardIds).toEqual(['draw-me']);

    expect((replayGame.state as any).zones?.[playerId]?.hand?.map((card: any) => card.id)).toEqual(['draw-me']);
    expect((replayGame as any).libraries.get(playerId).map((card: any) => card.id)).toEqual([]);
    expect((replayGame.state as any).oracleIrPendingResumeStepsJson).toBeUndefined();
  });

  it('joinGame completes library-search compound draw from pending resume state', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const joinGameId = 'test_oracle_ir_search_draw_join_compound';
    await resetSocketGame(joinGameId);

    const library = [
      { id: 'land-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
    ];

    createGameIfNotExists(joinGameId, 'commander', 40, undefined, playerId);
    const liveGame = ensureGame(joinGameId);
    if (!liveGame) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(liveGame, joinGameId, library);
    queueStackSpell(liveGame, {
      id: 'search_draw_join_1',
      name: 'Probe Search Draw',
      type_line: 'Sorcery',
      oracle_text: searchDrawOracleText,
      mana_cost: '{2}{G}',
    }, 'search_draw_stack_join_1');

    const liveEmitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: liveSocket, handlers: liveHandlers } = createMockSocket(playerId, joinGameId, liveEmitted);
    const liveIo = createMockIo(liveEmitted, [liveSocket]);
    registerResolutionHandlers(liveIo as any, liveSocket as any);

    resolveTopOfStack(liveGame as any);
    const searchStep = ResolutionQueueManager.getStepsForPlayer(joinGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    await liveHandlers['submitResolutionResponse']({
      gameId: joinGameId,
      stepId: String(searchStep.id),
      selections: ['land-1'],
    });

    const resolvedEvent = [...getEvents(joinGameId)].reverse()
      .find((event) => event.type === 'librarySearchResolve') as any;
    expect(resolvedEvent).toBeDefined();

    ResolutionQueueManager.removeQueue(joinGameId);
    (liveGame.state as any).players = [{
      id: playerId,
      name: 'P1',
      spectator: false,
      life: 40,
      seatToken: 'seat_p1',
    }];
    (liveGame.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: library.map((card) => ({ ...card, zone: 'library' })),
        libraryCount: library.length,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    liveGame.libraries = new Map([
      [playerId, library.map((card) => ({ ...card, zone: 'library' }))],
    ]);
    (liveGame.state as any).battlefield = [];
    delete (liveGame.state as any).oracleIrPendingResumeStepsJson;
    delete (liveGame.state as any).oracleIrPendingResumeControllerId;

    liveGame.applyEvent({
      type: 'librarySearchResolve',
      ...resolvedEvent.payload,
    });

    expect((liveGame.state as any).zones?.[playerId]?.hand || []).toHaveLength(0);
    expect(String((liveGame.state as any).oracleIrPendingResumeStepsJson || '')).toContain('conditional');

    const joinEmitted: Array<{ room?: string; event: string; payload: any }> = [];
    const joinHandlers: Record<string, (payload: any) => Promise<void> | void> = {};
    const joinSocket = {
      id: 'sock_search_draw_join',
      data: { spectator: false },
      rooms: new Set<string>(),
      on: (event: string, handler: (payload: any) => Promise<void> | void) => {
        joinHandlers[event] = handler;
      },
      emit: (event: string, payload: any) => joinEmitted.push({ event, payload }),
      join: (room: string) => joinSocket.rooms.add(room),
    };
    const joinIo = createMockIo(joinEmitted, [joinSocket]);

    registerJoinHandlers(joinIo as any, joinSocket as any);
    await joinHandlers['joinGame']({ gameId: joinGameId, fixedPlayerId: playerId });

    expect((liveGame.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id)).toEqual(['draw-me']);
    expect((liveGame as any).libraries.get(playerId).map((entry: any) => entry.id)).toEqual([]);
    expect((liveGame.state as any).oracleIrPendingResumeStepsJson).toBeUndefined();

    const drawEvent = [...getEvents(joinGameId)].reverse()
      .find((event) => event.type === 'drawCards' && event.payload?.oracleIrCompoundResume === true);
    expect(drawEvent).toBeDefined();
    expect(drawEvent?.payload?.drawnCardIds).toEqual(['draw-me']);
  });
});

describe('oracle IR Big Score stack resolve E2E', () => {
  const bigScoreGameId = 'test_oracle_ir_big_score_stack_resolve';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetSocketGame(bigScoreGameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetSocketGame(bigScoreGameId);
  });

  it('resolveTopOfStack draws three then creates two Treasure tokens under IR primary', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const library = [
      { id: 'draw-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-2', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
      { id: 'draw-3', name: 'Mountain', type_line: 'Basic Land — Mountain', image_uris: { normal: 'mountain.png' } },
      { id: 'bottom', name: 'Plains', type_line: 'Basic Land — Plains', image_uris: { normal: 'plains.png' } },
    ];

    createGameIfNotExists(bigScoreGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(bigScoreGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, bigScoreGameId, library);

    queueStackSpell(game, {
      id: 'big_score_1',
      name: 'Big Score',
      type_line: 'Sorcery',
      oracle_text: 'Draw three cards, then create two Treasure tokens.',
      mana_cost: '{4}{R}',
    }, 'big_score_stack_1');

    resolveTopOfStack(game as any);

    expect((game.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id))
      .toEqual(['draw-1', 'draw-2', 'draw-3']);
    expect(game.libraries.get(playerId).map((entry: any) => entry.id)).toEqual(['bottom']);
    expect(ResolutionQueueManager.getStepsForPlayer(bigScoreGameId, playerId)).toHaveLength(0);
    expect((game.state as any).stack || []).toHaveLength(0);

    const treasureTokens = ((game.state as any).battlefield || []).filter(
      (entry: any) => String(entry?.name || entry?.card?.name || '').includes('Treasure'),
    );
    expect(treasureTokens.length).toBe(2);
    expect(treasureTokens.every((entry: any) => String(entry?.controller || '') === playerId)).toBe(true);
  });
});

describe('oracle IR wheel stack resolve E2E', () => {
  const reforgeGameId = 'test_oracle_ir_reforge_stack_resolve';
  const windfallGameId = 'test_oracle_ir_windfall_stack_resolve';
  const echoGameId = 'test_oracle_ir_echo_stack_resolve';
  const player2Id = 'p2' as PlayerID;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetSocketGame(reforgeGameId);
    await resetSocketGame(windfallGameId);
    await resetSocketGame(echoGameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetSocketGame(reforgeGameId);
    await resetSocketGame(windfallGameId);
    await resetSocketGame(echoGameId);
  });

  function setupTwoPlayerWheelGame(
    game: ReturnType<typeof createInitialGameState>,
    gameId: string,
    options: {
      p1Hand: Array<Record<string, unknown>>;
      p2Hand: Array<Record<string, unknown>>;
      p1Library: Array<Record<string, unknown>>;
      p2Library: Array<Record<string, unknown>>;
    },
  ) {
    (game as any).gameId = gameId;
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: player2Id, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: options.p1Hand.map((card) => ({ ...card, zone: 'hand' })),
        handCount: options.p1Hand.length,
        graveyard: [],
        graveyardCount: 0,
        library: options.p1Library.map((card) => ({ ...card, zone: 'library' })),
        libraryCount: options.p1Library.length,
      },
      [player2Id]: {
        hand: options.p2Hand.map((card) => ({ ...card, zone: 'hand' })),
        handCount: options.p2Hand.length,
        graveyard: [],
        graveyardCount: 0,
        library: options.p2Library.map((card) => ({ ...card, zone: 'library' })),
        libraryCount: options.p2Library.length,
      },
    };
    const p1 = (game.state as any).players.find((entry: any) => entry.id === playerId);
    const p2 = (game.state as any).players.find((entry: any) => entry.id === player2Id);
    p1.library = options.p1Library.map((card) => ({ ...card, zone: 'library' }));
    p2.library = options.p2Library.map((card) => ({ ...card, zone: 'library' }));
    game.libraries = new Map([
      [playerId, options.p1Library.map((card) => ({ ...card, zone: 'library' }))],
      [player2Id, options.p2Library.map((card) => ({ ...card, zone: 'library' }))],
    ]);
  }

  function setupTwoPlayerEchoGame(
    game: ReturnType<typeof createInitialGameState>,
    gameId: string,
    options: {
      p1Hand: Array<Record<string, unknown>>;
      p2Hand: Array<Record<string, unknown>>;
      p1Graveyard: Array<Record<string, unknown>>;
      p2Graveyard: Array<Record<string, unknown>>;
      p1Library: Array<Record<string, unknown>>;
      p2Library: Array<Record<string, unknown>>;
    },
  ) {
    (game as any).gameId = gameId;
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: player2Id, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: options.p1Hand.map((card) => ({ ...card, zone: 'hand' })),
        handCount: options.p1Hand.length,
        graveyard: options.p1Graveyard.map((card) => ({ ...card, zone: 'graveyard' })),
        graveyardCount: options.p1Graveyard.length,
        library: options.p1Library.map((card) => ({ ...card, zone: 'library' })),
        libraryCount: options.p1Library.length,
      },
      [player2Id]: {
        hand: options.p2Hand.map((card) => ({ ...card, zone: 'hand' })),
        handCount: options.p2Hand.length,
        graveyard: options.p2Graveyard.map((card) => ({ ...card, zone: 'graveyard' })),
        graveyardCount: options.p2Graveyard.length,
        library: options.p2Library.map((card) => ({ ...card, zone: 'library' })),
        libraryCount: options.p2Library.length,
      },
    };
    const p1 = (game.state as any).players.find((entry: any) => entry.id === playerId);
    const p2 = (game.state as any).players.find((entry: any) => entry.id === player2Id);
    p1.library = options.p1Library.map((card) => ({ ...card, zone: 'library' }));
    p2.library = options.p2Library.map((card) => ({ ...card, zone: 'library' }));
    game.libraries = new Map([
      [playerId, options.p1Library.map((card) => ({ ...card, zone: 'library' }))],
      [player2Id, options.p2Library.map((card) => ({ ...card, zone: 'library' }))],
    ]);
  }

  it('resolveTopOfStack on Reforge the Soul discards each hand then draws seven', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const p1Hand = [
      { id: 'p1_hand_1', name: 'Opt', type_line: 'Instant' },
      { id: 'p1_hand_2', name: 'Bolt', type_line: 'Instant' },
    ];
    const p2Hand = Array.from({ length: 4 }, (_, index) => ({
      id: `p2_hand_${index}`,
      name: `P2 Hand ${index}`,
      type_line: 'Instant',
    }));
    const p1Library = Array.from({ length: 10 }, (_, index) => ({
      id: `p1_lib_${index}`,
      name: `P1 Library ${index}`,
      type_line: 'Instant',
    }));
    const p2Library = Array.from({ length: 10 }, (_, index) => ({
      id: `p2_lib_${index}`,
      name: `P2 Library ${index}`,
      type_line: 'Instant',
    }));

    createGameIfNotExists(reforgeGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(reforgeGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupTwoPlayerWheelGame(game, reforgeGameId, { p1Hand, p2Hand, p1Library, p2Library });

    queueStackSpell(game, {
      id: 'reforge_1',
      name: 'Reforge the Soul',
      type_line: 'Sorcery',
      oracle_text: 'Each player discards their hand, then draws seven cards.',
      mana_cost: '{4}{R}{R}',
    }, 'reforge_stack_1');

    resolveTopOfStack(game as any);

    expect((game.state as any).zones?.[playerId]?.hand).toHaveLength(7);
    expect((game.state as any).zones?.[player2Id]?.hand).toHaveLength(7);
    expect((game.state as any).zones?.[playerId]?.graveyard?.map((entry: any) => entry.id))
      .toEqual(expect.arrayContaining(['p1_hand_1', 'p1_hand_2', 'reforge_1']));
    expect((game.state as any).zones?.[playerId]?.graveyard).toHaveLength(3);
    expect((game.state as any).zones?.[player2Id]?.graveyard?.map((entry: any) => entry.id))
      .toEqual(['p2_hand_0', 'p2_hand_1', 'p2_hand_2', 'p2_hand_3']);
    expect(game.libraries.get(playerId)).toHaveLength(3);
    expect(game.libraries.get(player2Id)).toHaveLength(3);
    expect((game.state as any).stack || []).toHaveLength(0);
  });

  it('resolveTopOfStack on Windfall draws equal to the largest discarded hand', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const p1Hand = Array.from({ length: 3 }, (_, index) => ({
      id: `p1_hand_${index}`,
      name: `P1 Hand ${index}`,
      type_line: 'Instant',
    }));
    const p2Hand = Array.from({ length: 5 }, (_, index) => ({
      id: `p2_hand_${index}`,
      name: `P2 Hand ${index}`,
      type_line: 'Instant',
    }));
    const p1Library = Array.from({ length: 10 }, (_, index) => ({
      id: `p1_lib_${index}`,
      name: `P1 Library ${index}`,
      type_line: 'Instant',
    }));
    const p2Library = Array.from({ length: 10 }, (_, index) => ({
      id: `p2_lib_${index}`,
      name: `P2 Library ${index}`,
      type_line: 'Instant',
    }));

    createGameIfNotExists(windfallGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(windfallGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupTwoPlayerWheelGame(game, windfallGameId, { p1Hand, p2Hand, p1Library, p2Library });

    queueStackSpell(game, {
      id: 'windfall_1',
      name: 'Windfall',
      type_line: 'Instant',
      oracle_text: 'Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.',
      mana_cost: '{2}{U}{U}',
    }, 'windfall_stack_1');

    resolveTopOfStack(game as any);

    expect((game.state as any).zones?.[playerId]?.hand).toHaveLength(5);
    expect((game.state as any).zones?.[player2Id]?.hand).toHaveLength(5);
    expect((game.state as any).zones?.[playerId]?.graveyard?.map((entry: any) => entry.id))
      .toEqual(expect.arrayContaining(['p1_hand_0', 'p1_hand_1', 'p1_hand_2', 'windfall_1']));
    expect((game.state as any).zones?.[playerId]?.graveyard).toHaveLength(4);
    expect((game.state as any).zones?.[player2Id]?.graveyard).toHaveLength(5);
    expect(game.libraries.get(playerId)).toHaveLength(5);
    expect(game.libraries.get(player2Id)).toHaveLength(5);
    expect((game.state as any).stack || []).toHaveLength(0);
  });

  it('resolveTopOfStack on Echo of Eons shuffles hand and graveyard into library then draws seven', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const p1Hand = [
      { id: 'p1_hand_1', name: 'Opt', type_line: 'Instant' },
      { id: 'p1_hand_2', name: 'Bolt', type_line: 'Instant' },
    ];
    const p2Hand = [{ id: 'p2_hand_1', name: 'Shock', type_line: 'Instant' }];
    const p1Graveyard = [{ id: 'p1_gy_1', name: 'Mountain', type_line: 'Basic Land — Mountain' }];
    const p2Graveyard = [{ id: 'p2_gy_1', name: 'Island', type_line: 'Basic Land — Island' }];
    const p1Library = Array.from({ length: 10 }, (_, index) => ({
      id: `p1_lib_${index}`,
      name: `P1 Library ${index}`,
      type_line: 'Instant',
    }));
    const p2Library = Array.from({ length: 10 }, (_, index) => ({
      id: `p2_lib_${index}`,
      name: `P2 Library ${index}`,
      type_line: 'Instant',
    }));

    createGameIfNotExists(echoGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(echoGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupTwoPlayerEchoGame(game, echoGameId, {
      p1Hand,
      p2Hand,
      p1Graveyard,
      p2Graveyard,
      p1Library,
      p2Library,
    });

    queueStackSpell(game, {
      id: 'echo_1',
      name: 'Echo of Eons',
      type_line: 'Sorcery',
      oracle_text: 'Each player shuffles their hand and graveyard into their library, then draws seven cards.',
      mana_cost: '{4}{U}{U}',
    }, 'echo_stack_1');

    resolveTopOfStack(game as any);

    expect((game.state as any).zones?.[playerId]?.hand).toHaveLength(7);
    expect((game.state as any).zones?.[player2Id]?.hand).toHaveLength(7);
    expect((game.state as any).zones?.[player2Id]?.graveyard || []).toHaveLength(0);
    expect((game.state as any).zones?.[playerId]?.graveyard?.map((entry: any) => entry.id))
      .toEqual(['echo_1']);
    expect(game.libraries.get(playerId)).toHaveLength(6);
    expect(game.libraries.get(player2Id)).toHaveLength(5);
    expect((game.state as any).stack || []).toHaveLength(0);
  });
});

describe('oracle IR Inspiring Call stack resolve E2E', () => {
  const inspiringCallGameId = 'test_oracle_ir_inspiring_call_stack_resolve';

  function hasIndestructible(perm: any): boolean {
    const fromTemporaryAbilities = (perm?.temporaryAbilities || []).some((entry: any) => {
      const text = typeof entry === 'string' ? entry : String(entry?.ability || '');
      return text.toLowerCase().includes('indestructible');
    });
    const fromTemporaryEffects = (perm?.temporaryEffects || []).some((effect: any) =>
      (effect.grantedAbilities || []).includes('indestructible')
      || String(effect.description || '').toLowerCase().includes('indestructible')
    );
    return fromTemporaryAbilities || fromTemporaryEffects;
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetSocketGame(inspiringCallGameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetSocketGame(inspiringCallGameId);
  });

  it('resolveTopOfStack draws per +1/+1 creature then grants indestructible under IR primary', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const library = [
      { id: 'draw-1', name: 'Forest', type_line: 'Basic Land — Forest', image_uris: { normal: 'forest.png' } },
      { id: 'draw-2', name: 'Island', type_line: 'Basic Land — Island', image_uris: { normal: 'island.png' } },
      { id: 'bottom', name: 'Mountain', type_line: 'Basic Land — Mountain', image_uris: { normal: 'mountain.png' } },
    ];

    createGameIfNotExists(inspiringCallGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(inspiringCallGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    setupStackSpellLibraryGame(game, inspiringCallGameId, library);
    (game.state as any).battlefield = [
      {
        id: 'c1',
        controller: playerId,
        card: { name: 'Merfolk', type_line: 'Creature — Merfolk' },
        counters: { '+1/+1': 1 },
      },
      {
        id: 'c2',
        controller: playerId,
        card: { name: 'Elf', type_line: 'Creature — Elf' },
        counters: { '+1/+1': 2 },
      },
      {
        id: 'c3',
        controller: playerId,
        card: { name: 'Vanilla', type_line: 'Creature — Human' },
        counters: {},
      },
    ];

    const oracleText =
      'Draw a card for each creature you control with a +1/+1 counter on it. Those creatures gain indestructible until end of turn. (Damage and effects that say "destroy" don\'t destroy them.)';

    queueStackSpell(game, {
      id: 'inspiring_call_1',
      name: 'Inspiring Call',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{2}{G}',
    }, 'inspiring_call_stack_1');

    resolveTopOfStack(game as any);

    expect((game.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id))
      .toEqual(['draw-1', 'draw-2']);
    expect(game.libraries.get(playerId).map((entry: any) => entry.id)).toEqual(['bottom']);
    expect(ResolutionQueueManager.getStepsForPlayer(inspiringCallGameId, playerId)).toHaveLength(0);
    expect((game.state as any).stack || []).toHaveLength(0);

    const battlefield = (game.state as any).battlefield || [];
    expect(hasIndestructible(battlefield.find((perm: any) => perm.id === 'c1'))).toBe(true);
    expect(hasIndestructible(battlefield.find((perm: any) => perm.id === 'c2'))).toBe(true);
    expect(hasIndestructible(battlefield.find((perm: any) => perm.id === 'c3'))).toBe(false);
  });
});
