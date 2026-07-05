import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const gameIdPlay = 'test_put_land_from_hand_trigger_ir_play';
const gameIdDecline = 'test_put_land_from_hand_trigger_ir_decline';
const playerId = 'p1' as PlayerID;

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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // test-only cleanup
  }
}

describe('put land from hand trigger (Layer 3 IR primary)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    await resetGame(gameIdPlay);
    await resetGame(gameIdDecline);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    await resetGame(gameIdPlay);
    await resetGame(gameIdDecline);
  });

  function seedGame(gameId: string) {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;
    games.set(gameId as any, game as any);

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'forest_1',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            zone: 'hand',
          },
        ],
        handCount: 1,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'exploration_perm',
        controller: playerId,
        owner: playerId,
        card: {
          name: 'Exploration',
          type_line: 'Enchantment',
          oracle_text: 'You may play an additional land on each of your turns.\nAt the beginning of your upkeep, you may put a land card from your hand onto the battlefield.',
        },
      },
    ];
    return game;
  }

  it('queues play_land/decline (not draw fallback) for bare optional land step', async () => {
    const game = seedGame(gameIdPlay);

    executeTriggerEffect(
      game as any,
      playerId,
      'Exploration',
      'you may put a land card from your hand onto the battlefield',
      {
        id: 'exploration_upkeep',
        source: 'exploration_perm',
        sourceId: 'exploration_perm',
        triggerType: 'upkeep',
      },
    );

    const landStep = ResolutionQueueManager.getQueue(gameIdPlay).steps.find(
      (step) => step.type === ResolutionStepType.KYNAIOS_CHOICE,
    ) as any;
    expect(landStep).toBeDefined();
    expect(String(landStep?.description || '')).toMatch(/put a land card from your hand onto the battlefield/i);
    expect(String(landStep?.description || '')).not.toMatch(/draw a card/i);
    expect(landStep?.landPlayOrFallbackOptions || landStep?.options).toEqual(['play_land', 'decline']);
  }, 20000);

  it('puts the chosen land onto the battlefield when play_land is selected', async () => {
    const game = seedGame(gameIdPlay);

    executeTriggerEffect(
      game as any,
      playerId,
      'Exploration',
      'you may put a land card from your hand onto the battlefield',
      {
        id: 'exploration_upkeep_play',
        source: 'exploration_perm',
        sourceId: 'exploration_perm',
      },
    );

    const landStep = ResolutionQueueManager.getQueue(gameIdPlay).steps.find(
      (step) => step.type === ResolutionStepType.KYNAIOS_CHOICE,
    ) as any;
    expect(landStep).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameIdPlay, emitted);
    registerResolutionHandlers(createMockIo(emitted, [socket]) as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId: gameIdPlay,
      stepId: String(landStep.id),
      selections: { choice: 'play_land', landCardId: 'forest_1' },
    });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.some((perm: any) => perm?.card?.name === 'Forest')).toBe(true);
    expect((game.state as any).zones[playerId].hand).toEqual([]);
  }, 20000);

  it('leaves the land in hand when decline is selected', async () => {
    const game = seedGame(gameIdDecline);

    executeTriggerEffect(
      game as any,
      playerId,
      'Exploration',
      'you may put a land card from your hand onto the battlefield',
      {
        id: 'exploration_upkeep_decline',
        source: 'exploration_perm',
        sourceId: 'exploration_perm',
      },
    );

    const landStep = ResolutionQueueManager.getQueue(gameIdDecline).steps.find(
      (step) => step.type === ResolutionStepType.KYNAIOS_CHOICE,
    ) as any;
    expect(landStep).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameIdDecline, emitted);
    registerResolutionHandlers(createMockIo(emitted, [socket]) as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId: gameIdDecline,
      stepId: String(landStep.id),
      selections: { choice: 'decline' },
    });

    expect((game.state as any).zones[playerId].hand).toHaveLength(1);
    expect((game.state as any).battlefield).toHaveLength(1);
  }, 20000);
});
