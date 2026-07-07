/**
 * Replay-divergence guardrail for IR spells that defer finalize while resolution
 * choices are pending (CR 608.2m — oracleIrDeferredFinalize).
 *
 * Each case drives the live socket path under ORACLE_IR_SPELL_PRIMARY=1, replays
 * the persisted event log, and asserts projection parity via assertNoReplayDivergence.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { lookupLocalCardByNameSync } from '../src/services/localCardLookup.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { createInitialGameState } from '../src/state/index.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { assertNoReplayDivergence, toReplayEvents } from './helpers/replayDivergence.js';

const playerId = 'p1' as PlayerID;

const searchDrawOracleText =
  'Search your library for a basic land card, reveal it, put it onto the battlefield tapped, then shuffle. '
  + 'If you searched your library this way, draw a card.';

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

function createMockSocket(targetGameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId: targetGameId },
    rooms: new Set<string>([targetGameId]),
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
  GameManager.deleteGame(targetGameId);
  games.delete(targetGameId as any);
  try {
    await deleteGame(targetGameId);
  } catch {
    // test-only cleanup
  }
}

function setupStackSpellLibraryGame(
  game: any,
  targetGameId: string,
  library: Array<Record<string, unknown>>,
) {
  (game as any).gameId = targetGameId;
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
  game.libraries = new Map([[playerId, library.map((card) => ({ ...card, zone: 'library' }))]]);
}

function queueStackSpell(
  game: any,
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

function replayFromLiveEvents(
  liveGameId: string,
  replayGameId: string,
  eventStart: number,
  seedReplay: (game: any, targetGameId: string) => void,
) {
  const replayGame = createInitialGameState(replayGameId);
  seedReplay(replayGame, replayGameId);
  if (typeof replayGame.replay !== 'function') {
    throw new Error('replayGame.replay is not available');
  }
  replayGame.replay(toReplayEvents(liveGameId, eventStart) as any);
  return replayGame;
}

describe('oracle IR deferred-finalize replay divergence (Layer 3)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;
  });

  afterEach(() => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
  });

  it('Chart a Course discard + deferred finalize replays without divergence', async () => {
    const liveGameId = 'test_deferred_replay_chart';
    const replayGameId = `${liveGameId}_replay`;
    await resetGame(liveGameId);
    await resetGame(replayGameId);

    const card = lookupLocalCardByNameSync('Chart a Course');
    const oracleText = String(card?.oracle_text || '').trim();
    const library = [
      { id: 'draw-1', name: 'Forest', type_line: 'Basic Land — Forest' },
      { id: 'draw-2', name: 'Island', type_line: 'Basic Land — Island' },
      { id: 'bottom', name: 'Mountain', type_line: 'Basic Land — Mountain' },
    ];

    const seed = (game: any, targetGameId: string) => {
      setupStackSpellLibraryGame(game, targetGameId, library);
      (game.state as any).attackedPlayersThisTurnByPlayer = { [playerId]: [] };
      queueStackSpell(game, {
        id: 'chart_replay_1',
        name: 'Chart a Course',
        type_line: String(card?.type_line || 'Sorcery'),
        oracle_text: oracleText,
        mana_cost: String(card?.mana_cost || '{1}{U}'),
      }, 'chart_stack_replay_1');
    };

    createGameIfNotExists(liveGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(liveGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    seed(game, liveGameId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(liveGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const eventStart = getEvents(liveGameId).length;
    resolveTopOfStack(game as any);

    const discardStep = ResolutionQueueManager.getStepsForPlayer(liveGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: liveGameId,
      stepId: String(discardStep.id),
      selections: ['draw-1'],
    });

    expect((game.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id)).toEqual(['draw-2']);
    expect((game.state as any).stack || []).toHaveLength(0);
    expect(ResolutionQueueManager.getStepsForPlayer(liveGameId, playerId)).toHaveLength(0);

    const replayGame = replayFromLiveEvents(liveGameId, replayGameId, eventStart, seed);
    assertNoReplayDivergence(game, replayGame);

    await resetGame(liveGameId);
    await resetGame(replayGameId);
  }, 120000);

  it('library search compound draw replays without divergence', async () => {
    const liveGameId = 'test_deferred_replay_search_draw';
    const replayGameId = `${liveGameId}_replay`;
    await resetGame(liveGameId);
    await resetGame(replayGameId);

    const library = [
      { id: 'land-1', name: 'Forest', type_line: 'Basic Land — Forest' },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island' },
    ];

    const seed = (game: any, targetGameId: string) => {
      setupStackSpellLibraryGame(game, targetGameId, library);
      queueStackSpell(game, {
        id: 'search_draw_replay_1',
        name: 'Probe Search Draw',
        type_line: 'Sorcery',
        oracle_text: searchDrawOracleText,
        mana_cost: '{2}{G}',
      }, 'search_draw_stack_replay_1');
    };

    createGameIfNotExists(liveGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(liveGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    seed(game, liveGameId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(liveGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const eventStart = getEvents(liveGameId).length;
    resolveTopOfStack(game as any);

    const searchStep = ResolutionQueueManager.getStepsForPlayer(liveGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    expect(searchStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: liveGameId,
      stepId: String(searchStep.id),
      selections: ['land-1'],
    });

    expect((game.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id)).toEqual(['draw-me']);
    expect((game.state as any).stack || []).toHaveLength(0);

    const replayGame = replayFromLiveEvents(liveGameId, replayGameId, eventStart, seed);
    assertNoReplayDivergence(game, replayGame);

    await resetGame(liveGameId);
    await resetGame(replayGameId);
  }, 120000);

  it('Opt scry compound draw replays without divergence', async () => {
    const liveGameId = 'test_deferred_replay_opt_scry';
    const replayGameId = `${liveGameId}_replay`;
    await resetGame(liveGameId);
    await resetGame(replayGameId);

    const library = [
      { id: 'top-1', name: 'Forest', type_line: 'Basic Land — Forest' },
      { id: 'draw-me', name: 'Island', type_line: 'Basic Land — Island' },
    ];

    const seed = (game: any, targetGameId: string) => {
      setupStackSpellLibraryGame(game, targetGameId, library);
      queueStackSpell(game, {
        id: 'opt_replay_1',
        name: 'Opt',
        type_line: 'Instant',
        oracle_text: 'Scry 1. Draw a card.',
        mana_cost: '{U}',
      }, 'opt_stack_replay_1');
    };

    createGameIfNotExists(liveGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(liveGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    seed(game, liveGameId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(liveGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const eventStart = getEvents(liveGameId).length;
    resolveTopOfStack(game as any);

    const scryStep = ResolutionQueueManager.getStepsForPlayer(liveGameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.SCRY) as any;
    expect(scryStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: liveGameId,
      stepId: String(scryStep.id),
      selections: {
        keepTopOrder: [],
        bottomOrder: ['top-1'],
      },
    });

    expect((game.state as any).zones?.[playerId]?.hand?.map((entry: any) => entry.id)).toEqual(['draw-me']);
    expect((game.state as any).stack || []).toHaveLength(0);

    const replayGame = replayFromLiveEvents(liveGameId, replayGameId, eventStart, seed);
    assertNoReplayDivergence(game, replayGame);

    await resetGame(liveGameId);
    await resetGame(replayGameId);
  }, 120000);
});
