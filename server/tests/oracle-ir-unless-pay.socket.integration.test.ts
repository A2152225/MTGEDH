import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

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

describe('oracle IR unless-pay socket integration (Layer 3)', () => {
  const gameId = 'test_oracle_ir_unless_pay_socket';
  const p1 = 'p1';
  const p2 = 'p2';

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
    await resetGame(gameId);
  });

  it('queues unless-pay OPTION_CHOICE on stack resolve and counters when opponent declines via submitResolutionResponse', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);

    games.set(gameId as any, game as any);

    Object.assign(game.state as any, {
      players: [
        { id: p1, name: 'P1', spectator: false, life: 40 },
        { id: p2, name: 'P2', spectator: false, life: 40 },
      ],
      life: { [p1]: 40, [p2]: 40 },
      turnPlayer: p1,
      priority: p1,
      stack: [
        {
          id: 'cultivate_stack',
          type: 'spell',
          controller: p2,
          owner: p2,
          card: { id: 'cultivate_card', name: 'Cultivate', type_line: 'Sorcery' },
          targets: [],
        },
        {
          id: 'force_spike_stack',
          type: 'spell',
          controller: p1,
          owner: p1,
          card: {
            id: 'force_spike_card',
            name: 'Force Spike',
            type_line: 'Instant',
            oracle_text: 'Counter target spell unless its controller pays {1}.',
          },
          targets: [{ id: 'cultivate_stack', kind: 'stack' }],
        },
      ],
      manaPool: {
        [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
      },
      zones: {
        [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
        [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
      },
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: p1Socket, handlers: p1Handlers } = createMockSocket(p1, gameId, emitted);
    const { socket: p2Socket, handlers: p2Handlers } = createMockSocket(p2, gameId, emitted);
    const io = createMockIo(emitted, [p1Socket, p2Socket]);
    registerResolutionHandlers(io as any, p1Socket as any);
    registerResolutionHandlers(io as any, p2Socket as any);

    resolveTopOfStack(game as any);

    const unlessStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, p2 as any)
      .find((step) => step.type === ResolutionStepType.OPTION_CHOICE && (step as any).oracleIrUnlessPayChoice === true);
    expect(unlessStep).toBeTruthy();

    await p2Handlers.submitResolutionResponse({
      gameId,
      stepId: String(unlessStep!.id),
      selections: ['decline'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(0);
    const p2Graveyard = (game.state as any).zones?.[p2]?.graveyard || [];
    expect(p2Graveyard.some((card: any) => String(card?.name || '') === 'Cultivate')).toBe(true);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  }, 15000);
});
