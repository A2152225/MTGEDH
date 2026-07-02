import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';

const gameId = 'test_oracle_ir_compound_resume_socket';
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

describe('oracle IR compound resume socket integration (Layer 3)', () => {
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

  it('submitResolutionResponse on discard resumes draw via oracleIrResumeStepsJson', async () => {
    const handCards = [
      { id: 'card-1', name: 'Lightning Bolt', zone: 'hand' },
      { id: 'card-2', name: 'Counterspell', zone: 'hand' },
      { id: 'card-3', name: 'Forest', zone: 'hand' },
    ];
    const libraryCards = [
      { id: 'lib-1', name: 'Island', zone: 'library' },
      { id: 'lib-2', name: 'Mountain', zone: 'library' },
      { id: 'lib-3', name: 'Plains', zone: 'library' },
    ];

    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);

    Object.assign(game.state as any, {
      players: [{ id: playerId, name: 'P1', spectator: false, life: 40 }],
      zones: {
        [playerId]: {
          hand: handCards.map((card) => ({ ...card })),
          handCount: handCards.length,
          graveyard: [],
          graveyardCount: 0,
        },
      },
    });
    const player = (game.state as any).players[0];
    player.hand = handCards.map((card) => ({ ...card }));
    player.library = libraryCards.map((card) => ({ ...card }));
    game.libraries = new Map([[playerId, libraryCards.map((card) => ({ ...card }))]]);

    const ctx = game as any;
    ctx.gameId = gameId;

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'mind-rot-socket',
      sourceName: 'Mind Rot',
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [
        { kind: 'discard', who: { kind: 'you' }, amount: { kind: 'number', value: 2 }, raw: 'Discard two cards.' } as any,
        { kind: 'draw', who: { kind: 'you' }, amount: { kind: 'number', value: 2 }, raw: 'Draw two cards.' } as any,
      ],
      irCtx,
      { allowOptional: false },
      { controller: playerId },
    );

    const discardStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)
      .find((step) => step.type === ResolutionStepType.DISCARD_SELECTION);
    expect(discardStep).toBeTruthy();
    expect(String((discardStep as any)?.oracleIrResumeStepsJson || '')).toContain('draw');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    registerResolutionHandlers(createMockIo(emitted, [socket]) as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(discardStep!.id),
      selections: ['card-1', 'card-3'],
      cancelled: false,
    });

    const handIds = ((game.state as any).zones?.[playerId]?.hand || []).map((card: any) => card.id);
    expect(handIds).toEqual(['card-2', 'lib-1', 'lib-2']);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  }, 15000);
});
