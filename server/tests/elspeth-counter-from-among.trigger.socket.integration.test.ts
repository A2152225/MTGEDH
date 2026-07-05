import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const gameId = 'test_elspeth_counter_from_among_trigger_ir';
const playerId = 'p1' as PlayerID;
const effectText =
  'Put a +1/+1 counter and a counter from among flying, first strike, lifelink, or vigilance on it.';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: () => undefined }),
    emit: () => undefined,
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])) },
  } as any;
}

function createMockSocket(pid: string, gid: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId: pid, spectator: false },
    rooms: new Set<string>([gid]),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

async function resetGame(gid: string) {
  ResolutionQueueManager.removeQueue(gid);
  games.delete(gid as any);
  try {
    await deleteGame(gid);
  } catch {
    // test-only cleanup
  }
}

describe('Elspeth counter-from-among trigger (Layer 3 IR primary)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    await resetGame(gameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    await resetGame(gameId);
  });

  function seedGame() {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;
    games.set(gameId as any, game as any);

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'bear',
        controller: playerId,
        owner: playerId,
        counters: {},
        grantedAbilities: [],
        card: {
          name: 'Bear',
          type_line: 'Creature — Bear',
          keywords: [],
        },
      },
    ];
    return game;
  }

  it('queues keyword counter MODAL_CHOICE after +1/+1 is applied', async () => {
    const game = seedGame();

    executeTriggerEffect(game as any, playerId, 'Elspeth Resplendent', effectText, {
      id: 'elspeth_plus_one',
      source: 'elspeth',
      sourceId: 'elspeth',
      targets: ['bear'],
    });

    const bear = ((game.state as any).battlefield || [])[0];
    expect(bear.counters['+1/+1']).toBe(1);

    const modalStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step) => step.type === ResolutionStepType.MODAL_CHOICE,
    ) as any;
    expect(modalStep).toBeDefined();
    expect(modalStep?.keywordCounterChoiceData?.targetPermanentId).toBe('bear');
    expect(modalStep?.keywordCounterChoiceData?.allowedKeywords).toEqual([
      'flying',
      'first strike',
      'lifelink',
      'vigilance',
    ]);
    expect(modalStep?.keywordCounterChoiceData?.extraCounters).toBeUndefined();
    expect((modalStep?.options || []).map((opt: any) => opt.id)).toEqual([
      'flying',
      'first_strike',
      'lifelink',
      'vigilance',
    ]);
  }, 20000);

  it('applies the chosen keyword counter when the modal resolves', async () => {
    const game = seedGame();

    executeTriggerEffect(game as any, playerId, 'Elspeth Resplendent', effectText, {
      id: 'elspeth_plus_one_resolve',
      source: 'elspeth',
      sourceId: 'elspeth',
      targets: ['bear'],
    });

    const modalStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step) => step.type === ResolutionStepType.MODAL_CHOICE,
    ) as any;
    expect(modalStep).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: modalStep.id,
      selections: 'lifelink',
    });

    const bear = ((game.state as any).battlefield || [])[0];
    expect(bear.counters['+1/+1']).toBe(1);
    expect(bear.counters.lifelink).toBe(1);
    expect(bear.card.keywords).toContain('Lifelink');
  }, 20000);
});
