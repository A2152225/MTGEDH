import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const gameIdNoCreature = 'test_sacrifice_lose_life_trigger_ir_no_creature';
const gameIdWithCreature = 'test_sacrifice_lose_life_trigger_ir_with_creature';
const controllerId = 'p1' as PlayerID;
const affectedId = 'p2' as PlayerID;
const effectText = 'that player sacrifices a creature of their choice and loses 3 life';

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

describe('sacrifice and lose life trigger (Layer 3 IR primary)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    await resetGame(gameIdNoCreature);
    await resetGame(gameIdWithCreature);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    await resetGame(gameIdNoCreature);
    await resetGame(gameIdWithCreature);
  });

  function seedGame(gameId: string, withCreature: boolean) {
    createGameIfNotExists(gameId, 'commander', 40, undefined, controllerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;
    games.set(gameId as any, game as any);

    (game.state as any).players = [
      { id: controllerId, name: 'P1', life: 40 },
      { id: affectedId, name: 'P2', life: 40 },
    ];
    (game.state as any).life = { [controllerId]: 40, [affectedId]: 40 };
    (game.state as any).zones = {
      [controllerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
      [affectedId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'ob_perm',
        controller: controllerId,
        owner: controllerId,
        card: {
          name: 'Ob Nixilis, Unshackled',
          type_line: 'Legendary Creature — Demon',
        },
      },
      ...(withCreature
        ? [{
            id: 'bear_perm',
            controller: affectedId,
            owner: affectedId,
            card: { name: 'Bear', type_line: 'Creature — Bear' },
          }]
        : []),
    ];

    return game;
  }

  const triggerItem = {
    id: 'library_search_punish_trigger',
    source: 'ob_perm',
    sourceId: 'ob_perm',
    targetPlayer: affectedId,
    triggeringPlayer: affectedId,
    effectData: { searchingPlayerId: affectedId },
  };

  it('applies lose_life when the affected player has no creatures to sacrifice', async () => {
    const game = seedGame(gameIdNoCreature, false);

    executeTriggerEffect(
      game as any,
      controllerId,
      'Ob Nixilis, Unshackled',
      effectText,
      triggerItem,
    );

    expect(ResolutionQueueManager.getQueue(gameIdNoCreature).steps).toHaveLength(0);
    expect((game.state as any).life?.[affectedId]).toBe(37);
  }, 20000);

  it('queues target_selection and applies lose_life after sacrifice selection', async () => {
    const game = seedGame(gameIdWithCreature, true);

    executeTriggerEffect(
      game as any,
      controllerId,
      'Ob Nixilis, Unshackled',
      effectText,
      triggerItem,
    );

    const sacStep = ResolutionQueueManager.getQueue(gameIdWithCreature).steps.find(
      (step) => step.type === ResolutionStepType.TARGET_SELECTION,
    ) as any;
    expect(sacStep).toBeDefined();
    expect(String(sacStep?.oracleIrResumeStepsJson || '')).toMatch(/lose_life/i);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(affectedId, gameIdWithCreature, emitted);
    registerResolutionHandlers(createMockIo(emitted, [socket]) as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId: gameIdWithCreature,
      stepId: String(sacStep.id),
      selections: ['bear_perm'],
    });

    expect((game.state as any).life?.[affectedId]).toBe(37);
    expect(((game.state as any).zones?.[affectedId]?.graveyard || []).some(
      (card: any) => card?.name === 'Bear',
    )).toBe(true);
    expect(((game.state as any).battlefield || []).some(
      (perm: any) => perm?.id === 'bear_perm',
    )).toBe(false);
  }, 20000);
});
