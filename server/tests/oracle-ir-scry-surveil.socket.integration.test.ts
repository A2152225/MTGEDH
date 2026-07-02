import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const gameId = 'test_oracle_ir_scry_surveil_socket';
const playerId = 'p1' as PlayerID;

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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // test-only cleanup
  }
}

function setupStackSpellLibraryGame(
  game: any,
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
  game: any,
  card: { id: string; name: string; type_line: string; oracle_text: string; mana_cost: string },
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

describe('oracle IR scry/surveil socket submit resume (Layer 3)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetGame(gameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetGame(gameId);
  });

  it('resolveTopOfStack queues IR scry for Opt then submitResolutionResponse completes the draw', async () => {
    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest' },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island' },
    ];

    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);
    setupStackSpellLibraryGame(game, library);
    queueStackSpell(game, {
      id: 'opt_socket_1',
      name: 'Opt',
      type_line: 'Instant',
      oracle_text: 'Scry 1. Draw a card.',
      mana_cost: '{U}',
    }, 'opt_stack_socket_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    registerResolutionHandlers(createMockIo(emitted, [socket]) as any, socket as any);

    resolveTopOfStack(game as any);

    const scryStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;
    expect(scryStep).toBeDefined();
    expect(String(scryStep.oracleIrChoiceStepJson || '')).toContain('scry');

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(scryStep.id),
      selections: { keepTopOrder: [], bottomOrder: ['top-1'] },
      cancelled: false,
    });

    const handIds = ((game.state as any).zones?.[playerId]?.hand || []).map((card: any) => card.id);
    expect(handIds).toEqual(['draw-me']);
    expect(game.libraries.get(playerId).map((card: any) => card.id)).toEqual(['top-1']);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, playerId)).toHaveLength(0);
  }, 15000);

  it('resolveTopOfStack queues IR surveil for Consider then submitResolutionResponse completes the draw', async () => {
    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest' },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island' },
    ];

    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);
    setupStackSpellLibraryGame(game, library);
    queueStackSpell(game, {
      id: 'consider_socket_1',
      name: 'Consider',
      type_line: 'Instant',
      oracle_text: 'Surveil 1. Draw a card.',
      mana_cost: '{U}',
    }, 'consider_stack_socket_1');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    registerResolutionHandlers(createMockIo(emitted, [socket]) as any, socket as any);

    resolveTopOfStack(game as any);

    const surveilStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SURVEIL) as any;
    expect(surveilStep).toBeDefined();
    expect(String(surveilStep.oracleIrChoiceStepJson || '')).toContain('surveil');

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(surveilStep.id),
      selections: { keepTopOrder: [], toGraveyard: ['top-1'] },
      cancelled: false,
    });

    const handIds = ((game.state as any).zones?.[playerId]?.hand || []).map((card: any) => card.id);
    const graveyardIds = ((game.state as any).zones?.[playerId]?.graveyard || []).map((card: any) => card.id);
    expect(handIds).toEqual(['draw-me']);
    expect(graveyardIds).toEqual(['top-1', 'consider_socket_1']);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, playerId)).toHaveLength(0);
  }, 15000);
});
