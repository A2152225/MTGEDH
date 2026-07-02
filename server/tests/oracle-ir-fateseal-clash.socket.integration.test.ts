import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { startOracleEffectProgramOnServer } from '../src/state/modules/oracleIrEffectProgramServer.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const gameId = 'test_oracle_ir_fateseal_clash_socket';
const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;

const fatesealSteps = [
  {
    kind: 'fateseal',
    who: { kind: 'you' },
    target: { kind: 'target_opponent' },
    amount: { kind: 'number', value: 2 },
    raw: 'Fateseal 2.',
  },
] as const;

const clashSteps = [
  {
    kind: 'clash',
    who: { kind: 'you' },
    opponent: { kind: 'target_opponent' },
    raw: 'Clash with an opponent.',
  },
] as const;

const clashGameId = 'test_oracle_ir_clash_ep_socket';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
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

async function resetGame(targetGameId: string) {
  ResolutionQueueManager.removeQueue(targetGameId);
  games.delete(targetGameId as any);
  try {
    await deleteGame(targetGameId);
  } catch {
    // test-only cleanup
  }
}

function seedTwoPlayerClashGame(game: any, targetGameId: string) {
  (game as any).gameId = targetGameId;
  (game.state as any).players = [
    { id: p1, name: 'P1', spectator: false, life: 40 },
    { id: p2, name: 'P2', spectator: false, life: 40 },
  ];
  const player1 = (game.state as any).players.find((entry: any) => entry.id === p1);
  const player2 = (game.state as any).players.find((entry: any) => entry.id === p2);
  player1.library = [
    { id: 'you-high', name: 'Dragon', type_line: 'Creature — Dragon', mana_cost: '{5}{R}', cmc: 6, zone: 'library' },
    { id: 'you-next', name: 'You Next', type_line: 'Instant', cmc: 2, zone: 'library' },
  ];
  player1.hand = [];
  player2.library = [
    { id: 'opp-low', name: 'Shock', type_line: 'Instant', mana_cost: '{R}', cmc: 1, zone: 'library' },
    { id: 'opp-next', name: 'Opponent Next', type_line: 'Land', cmc: 0, zone: 'library' },
  ];
  player2.hand = [];
  (game.state as any).zones = {
    [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 2 },
    [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 2 },
  };
  game.libraries = new Map([
    [p1, player1.library.map((card: any) => ({ ...card }))],
    [p2, player2.library.map((card: any) => ({ ...card }))],
  ]);
}

function seedTwoPlayerFatesealGame(game: any) {
  (game as any).gameId = gameId;
  (game.state as any).players = [
    { id: p1, name: 'P1', spectator: false, life: 40 },
    { id: p2, name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).zones = {
    [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0 },
    [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 3 },
  };
  const player2 = (game.state as any).players.find((entry: any) => entry.id === p2);
  player2.library = [
    { id: 'opp-top-a', name: 'Opponent Top A', zone: 'library' },
    { id: 'opp-top-b', name: 'Opponent Top B', zone: 'library' },
    { id: 'opp-remaining-c', name: 'Opponent Remaining C', zone: 'library' },
  ];
  game.libraries = new Map([
    [p1, []],
    [p2, player2.library.map((card: any) => ({ ...card }))],
  ]);
}

describe('oracle IR fateseal Effect Program socket submit resume (Layer 3)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('submitResolutionResponse resumes fateseal Effect Program through opponent choice and library reorder', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);
    seedTwoPlayerFatesealGame(game);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'fateseal-source-1',
      sourceName: 'Fateseal Source',
      sourceObjectType: 'spell',
    });

    const started = startOracleEffectProgramOnServer(game as any, {
      controller: p1,
      sourceName: 'Fateseal Source',
      sourceId: 'fateseal-source-1',
      steps: fatesealSteps as any,
      irCtx,
      executionOptions: { allowOptional: true },
      programIdPrefix: 'spell:fateseal-source-1',
      metadata: { family: 'spell_resolution' },
    });
    expect(started.handled).toBe(true);
    expect(started.waitingForChoice).toBe(true);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, gameId, emitted);
    registerResolutionHandlers(createMockIo(emitted, [socket]) as any, socket as any);

    const opponentChoice = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step) => step.type === ResolutionStepType.PLAYER_CHOICE,
    );
    expect(opponentChoice).toBeTruthy();
    expect((opponentChoice as any)?.effectProgramPrompt).toBe(true);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(opponentChoice!.id),
      selections: [p2],
      cancelled: false,
    });

    const fatesealStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step) => step.type === ResolutionStepType.FATESEAL,
    );
    expect(fatesealStep).toBeTruthy();
    expect((fatesealStep as any)?.fatesealCount).toBe(2);
    expect((fatesealStep as any)?.opponentId).toBe(p2);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(fatesealStep!.id),
      selections: { keepTopOrder: ['opp-top-b'], bottomOrder: ['opp-top-a'] },
      cancelled: false,
    });

    const libraryIds = (game.libraries.get(p2) || []).map((card: any) => card.id);
    expect(libraryIds).toEqual(['opp-top-b', 'opp-remaining-c', 'opp-top-a']);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  }, 20000);
});

describe('oracle IR clash Effect Program socket submit resume (Layer 3)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(clashGameId);
  });

  afterEach(async () => {
    await resetGame(clashGameId);
  });

  it('submitResolutionResponse resumes clash Effect Program through opponent and clash steps', async () => {
    createGameIfNotExists(clashGameId, 'commander', 40, undefined, p1);
    const game = ensureGame(clashGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(clashGameId as any, game as any);
    seedTwoPlayerClashGame(game, clashGameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'clash-source-1',
      sourceName: 'Clash Source',
      sourceObjectType: 'ability',
    });

    const started = startOracleEffectProgramOnServer(game as any, {
      controller: p1,
      sourceName: 'Clash Source',
      sourceId: 'clash-source-1',
      steps: clashSteps as any,
      irCtx,
      executionOptions: { allowOptional: true },
      programIdPrefix: 'trigger:clash-source-1',
      metadata: { family: 'trigger_resolution' },
    });
    expect(started.handled).toBe(true);
    expect(started.waitingForChoice).toBe(true);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: p1Socket, handlers: p1Handlers } = createMockSocket(p1, clashGameId, emitted);
    const { socket: p2Socket, handlers: p2Handlers } = createMockSocket(p2, clashGameId, emitted);
    registerResolutionHandlers(createMockIo(emitted, [p1Socket, p2Socket]) as any, p1Socket as any);
    registerResolutionHandlers(createMockIo(emitted, [p1Socket, p2Socket]) as any, p2Socket as any);

    const opponentChoice = ResolutionQueueManager.getQueue(clashGameId).steps.find(
      (step) => step.type === ResolutionStepType.PLAYER_CHOICE,
    );
    expect(opponentChoice).toBeTruthy();

    await p1Handlers.submitResolutionResponse({
      gameId: clashGameId,
      stepId: String(opponentChoice!.id),
      selections: [p2],
      cancelled: false,
    });

    const controllerClash = ResolutionQueueManager.getQueue(clashGameId).steps.find(
      (step) => step.type === ResolutionStepType.CLASH && String(step.playerId) === p1,
    );
    expect(controllerClash).toBeTruthy();
    expect((controllerClash as any)?.revealedCard?.id).toBe('you-high');

    await p1Handlers.submitResolutionResponse({
      gameId: clashGameId,
      stepId: String(controllerClash!.id),
      selections: { putOnBottom: false },
      cancelled: false,
    });

    const opponentClash = ResolutionQueueManager.getQueue(clashGameId).steps.find(
      (step) => step.type === ResolutionStepType.CLASH && String(step.playerId) === p2,
    );
    expect(opponentClash).toBeTruthy();
    expect((opponentClash as any)?.revealedCard?.id).toBe('opp-low');

    await p2Handlers.submitResolutionResponse({
      gameId: clashGameId,
      stepId: String(opponentClash!.id),
      selections: { putOnBottom: true },
      cancelled: false,
    });

    const player2 = (game.state as any).players.find((entry: any) => entry.id === p2);
    const p1LibraryIds = (game.libraries.get(p1) || []).map((card: any) => card.id);
    const p2LibraryIds = (player2.library || []).map((card: any) => card.id);
    expect(p1LibraryIds[0]).toBe('you-high');
    expect(p2LibraryIds).toEqual(['opp-next', 'opp-low']);
    expect(ResolutionQueueManager.getQueue(clashGameId).steps).toHaveLength(0);
  }, 20000);
});
